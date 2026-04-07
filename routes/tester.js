const express = require('express');
const router = express.Router();
const dbAdapter = require('../config/dbAdapter');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');

const resolveTesterId = (req) => {
  const headerTesterId = req.headers['x-user-id'];
  const queryTesterId = req.query.tester_id;
  const authTesterId = req.user?.userId;

  const resolved = headerTesterId || queryTesterId || authTesterId;
  const parsed = Number(resolved);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const PHOTO_RULES = {
  'SATRA-TM-174': { min: 1, max: 3, required: true },
  'SATRA-TM-92': { min: 2, max: 3, required: true },
  'SATRA-TM-161': { min: 2, max: 3, required: true },
  'SATRA-TM-281': { min: 2, max: 4, required: true },
  'PH-001': { min: 0, max: 2, required: false },
  'ISO-19574': { min: 2, max: 4, required: true },
  'FZ-001': { min: 2, max: 3, required: true },
  'HAO-001': { min: 2, max: 3, required: true },
  'SATRA-TM-31': { min: 2, max: 4, required: true }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    if (mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/png') {
      cb(null, true);
      return;
    }
    cb(new Error('Only JPG, JPEG, and PNG files are allowed'));
  }
});

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

// Get tester's assigned tests
router.get('/my-tests', async (req, res) => {
  try {
    const testerId = resolveTesterId(req);
    if (!testerId) {
      return res.status(400).json({ error: 'Valid tester ID is required' });
    }
    
    // Use direct pool connection to avoid adapter issues
    const { pool } = require('../config/database');
    
    const query = `
      SELECT
        at.id,
        at.test_name,
        at.test_standard,
        at.client_requirement,
        at.category,
        at.execution_type,
        at.inhouse_test_id,
        at.status,
        at.test_deadline,
        at.assigned_at,
        at.notes as admin_notes,
        at.is_periodic,
        at.periodic_schedule_id,
        at.periodic_run_number,
        ps.frequency_type AS periodic_frequency_type,
        ps.frequency_value AS periodic_frequency_value,
        ps.total_occurrences AS periodic_total_occurrences,
        ps.next_due_date AS periodic_schedule_next_due,
        ps.schedule_status AS periodic_schedule_status,
        ptr.due_date AS periodic_run_due_date,
        
        -- Article details (OK to show)
        a.article_name,
        a.article_number,
        a.material_type,
        a.color,
        a.description
        
        -- NO client details excluded

      FROM article_tests at
      JOIN articles a ON at.article_id = a.id
      LEFT JOIN periodic_schedules ps ON ps.id = at.periodic_schedule_id
      LEFT JOIN periodic_test_runs ptr ON ptr.article_test_id = at.id
        AND ptr.schedule_id = ps.id
        AND ptr.run_number = COALESCE(at.periodic_run_number, 1)

      WHERE at.assigned_tester_id = $1
      AND at.execution_type IN ('inhouse', 'both')

      ORDER BY at.test_deadline ASC NULLS LAST
    `;
    
    const client = await pool.connect();
    try {
      const result = await client.query(query, [testerId]);
      console.log('Found', result.rows.length, 'assigned tests for tester', testerId);
      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching tester tests:', error);
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
});

/** All runs for a periodic schedule (tester must be assigned to at least one test in this schedule). */
router.get('/periodic-schedules/:scheduleId/runs', async (req, res) => {
  try {
    const testerId = resolveTesterId(req);
    if (!testerId) {
      return res.status(400).json({ error: 'Valid tester ID is required' });
    }
    const { scheduleId } = req.params;
    const { pool } = require('../config/database');
    const access = await pool.query(
      `SELECT 1 FROM article_tests
       WHERE periodic_schedule_id = $1 AND assigned_tester_id = $2
       LIMIT 1`,
      [scheduleId, testerId]
    );
    if (access.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this schedule' });
    }
    const runs = await pool.query(
      `SELECT ptr.*, u.name AS tester_name,
              at.report_url AS article_report_url,
              at.report_number AS article_report_number,
              at.report_generated_at AS article_report_generated_at,
              at.status AS article_test_status
       FROM periodic_test_runs ptr
       LEFT JOIN users u ON u.id = ptr.assigned_tester_id
       LEFT JOIN article_tests at ON at.id = ptr.article_test_id
       WHERE ptr.schedule_id = $1
         AND (ptr.assigned_tester_id = $2 OR at.assigned_tester_id = $2)
       ORDER BY ptr.run_number ASC`,
      [scheduleId, testerId]
    );
    res.json(runs.rows);
  } catch (error) {
    console.error('Tester periodic runs error:', error);
    res.status(500).json({ error: 'Failed to load periodic runs' });
  }
});

/** Download CoA for a test assignment the tester owns (any run / historical). */
router.get('/my-tests/:orderTestId/download-report', async (req, res) => {
  try {
    const testerId = resolveTesterId(req);
    if (!testerId) {
      return res.status(400).json({ error: 'Valid tester ID is required' });
    }
    const { orderTestId } = req.params;
    const { pool } = require('../config/database');
    const r = await pool.query(
      `SELECT report_url, report_number FROM article_tests WHERE id = $1 AND assigned_tester_id = $2`,
      [orderTestId, testerId]
    );
    if (!r.rows.length || !r.rows[0].report_url) {
      return res.status(404).json({ error: 'Report not found' });
    }
    const reportUrl = r.rows[0].report_url;
    const absPath = path.resolve(__dirname, '..', String(reportUrl).replace(/^\//, ''));
    await fs.access(absPath);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="CoA_${String(r.rows[0].report_number || 'report').replace(/"/g, '')}.docx"`
    );
    res.sendFile(absPath);
  } catch (error) {
    console.error('Tester download report error:', error);
    res.status(500).json({ error: 'Failed to download report' });
  }
});

// Get single test detail for tester
router.get('/my-tests/:orderTestId', async (req, res) => {
  try {
    const { orderTestId } = req.params;
    const testerId = resolveTesterId(req);
    if (!testerId) {
      return res.status(400).json({ error: 'Valid tester ID is required' });
    }
    
    // Use direct pool connection to avoid adapter issues
    const { pool } = require('../config/database');
    
    const query = `
      SELECT
        at.id,
        at.test_name,
        at.test_standard,
        at.client_requirement,
        at.category,
        at.execution_type,
        at.inhouse_test_id,
        at.status,
        at.test_deadline,
        at.assigned_at,
        at.notes as admin_notes,
        at.result,
        at.result_data,
        at.submitted_at,
        at.is_periodic,
        at.periodic_schedule_id,
        at.periodic_run_number,
        ps.frequency_type AS periodic_frequency_type,
        ps.frequency_value AS periodic_frequency_value,
        ps.total_occurrences AS periodic_total_occurrences,
        ps.next_due_date AS periodic_schedule_next_due,
        ps.schedule_status AS periodic_schedule_status,
        ptr.due_date AS periodic_run_due_date,
        ps.notes AS periodic_schedule_notes,
        
        -- Article details (OK to show)
        a.article_name,
        a.article_number,
        a.material_type,
        a.color,
        a.description

      FROM article_tests at
      JOIN articles a ON at.article_id = a.id
      LEFT JOIN periodic_schedules ps ON ps.id = at.periodic_schedule_id
      LEFT JOIN periodic_test_runs ptr ON ptr.article_test_id = at.id
        AND ptr.schedule_id = ps.id
        AND ptr.run_number = COALESCE(at.periodic_run_number, 1)

      WHERE at.id = $1
      AND at.assigned_tester_id = $2
      AND at.execution_type IN ('inhouse', 'both')
    `;
    
    const client = await pool.connect();
    try {
      const result = await client.query(query, [orderTestId, testerId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Test not found or not assigned to you' });
      }
      
      res.json(result.rows[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching test detail:', error);
    res.status(500).json({ error: 'Failed to fetch test detail' });
  }
});

// Start test (change status from pending to in_progress)
router.post('/my-tests/:orderTestId/start', async (req, res) => {
  try {
    const { orderTestId } = req.params;
    const testerId = resolveTesterId(req);
    if (!testerId) {
      return res.status(400).json({ error: 'Valid tester ID is required' });
    }
    
    // Use direct pool connection to avoid adapter issues
    const { pool } = require('../config/database');
    
    const client = await pool.connect();
    try {
      // Verify the test belongs to this tester
      const checkResult = await client.query(`
        SELECT id FROM article_tests 
        WHERE id = $1 AND assigned_tester_id = $2 AND status IN ('pending', 'assigned')
      `, [orderTestId, testerId]);
      
      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: 'Test not found, not assigned to you, or already started' });
      }
      
      // Update test status
      await client.query(`
        UPDATE article_tests SET
          status = 'in_progress'
        WHERE id = $1
      `, [orderTestId]);
      
      res.json({ message: 'Test started successfully' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error starting test:', error);
    res.status(500).json({ error: 'Failed to start test' });
  }
});

// Submit results for an assigned in-house test (PASS/FAIL + calculation payload)
router.post('/my-tests/:orderTestId/submit-results', async (req, res) => {
  try {
    const { orderTestId } = req.params;
    const testerId = resolveTesterId(req);
    if (!testerId) {
      return res.status(400).json({ error: 'Valid tester ID is required' });
    }

    const { result, result_data } = req.body;
    if (!result || !['PASS', 'FAIL'].includes(String(result).toUpperCase())) {
      return res.status(400).json({ error: 'result must be PASS or FAIL' });
    }

    const { pool } = require('../config/database');
    const { advanceAfterPeriodicSubmit } = require('../services/periodicService');
    const client = await pool.connect();
    try {
      const own = await client.query(
        `SELECT id, inhouse_test_id, result_data FROM article_tests WHERE id = $1 AND assigned_tester_id = $2 AND execution_type IN ('inhouse', 'both')`,
        [orderTestId, testerId]
      );
      if (own.rows.length === 0) {
        return res.status(404).json({ error: 'Test not found or not assigned to you' });
      }

      const dbRow = own.rows[0];
      const currentResultData = dbRow.result_data && typeof dbRow.result_data === 'object' ? dbRow.result_data : {};
      const photos = Array.isArray(currentResultData.photos) ? currentResultData.photos : [];
      const photoRule = PHOTO_RULES[String(dbRow.inhouse_test_id || '').toUpperCase()] || { min: 0, required: false };
      if (photoRule.required && photos.length < photoRule.min) {
        return res.status(400).json({ error: `${photoRule.min} photo(s) required before submitting this test` });
      }

      const payload = result_data && typeof result_data === 'object' ? result_data : {};
      payload.photos = photos;
      const resultUpper = String(result).toUpperCase();

      await client.query('BEGIN');
      await client.query(
        `UPDATE article_tests SET
          result = $1,
          result_data = $2,
          status = 'submitted',
          submitted_at = NOW(),
          updated_at = NOW()
        WHERE id = $3`,
        [resultUpper, JSON.stringify(payload), orderTestId]
      );
      let periodicAdvance = null;
      try {
        periodicAdvance = await advanceAfterPeriodicSubmit(client, orderTestId, resultUpper, testerId);
      } catch (periodicErr) {
        if (periodicErr.code === '42P01') {
          console.warn('Periodic tables not installed; skipping advance:', periodicErr.message);
        } else {
          throw periodicErr;
        }
      }
      await client.query('COMMIT');
      res.json({
        message: 'Results submitted successfully',
        periodicNextTestId: periodicAdvance?.nextArticleTestId ?? null,
        periodicScheduleEnded: Boolean(periodicAdvance?.scheduleEnded),
        periodicAdvanced: Boolean(periodicAdvance?.advanced)
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error submitting tester results:', error);
    res.status(500).json({ error: 'Failed to submit results' });
  }
});

// Manual periodic advancement fallback: creates next cycle when current periodic run is already submitted
router.post('/my-tests/:orderTestId/advance-periodic', async (req, res) => {
  try {
    const { orderTestId } = req.params;
    const testerId = resolveTesterId(req);
    if (!testerId) {
      return res.status(400).json({ error: 'Valid tester ID is required' });
    }

    const { pool } = require('../config/database');
    const { advanceAfterPeriodicSubmit } = require('../services/periodicService');
    const client = await pool.connect();
    try {
      const own = await client.query(
        `SELECT id, result, status, periodic_schedule_id, periodic_run_number
         FROM article_tests
         WHERE id = $1 AND assigned_tester_id = $2 AND execution_type IN ('inhouse', 'both')`,
        [orderTestId, testerId]
      );
      if (own.rows.length === 0) {
        return res.status(404).json({ error: 'Test not found or not assigned to you' });
      }
      const t = own.rows[0];
      if (!t.periodic_schedule_id) {
        return res.status(400).json({ error: 'This is not a periodic test' });
      }
      if (String(t.status).toLowerCase() !== 'submitted') {
        return res.status(400).json({ error: 'Submit this test first before creating next cycle' });
      }

      await client.query('BEGIN');
      const resultUpper = String(t.result || 'FAIL').toUpperCase().includes('PASS') ? 'PASS' : 'FAIL';
      const periodicAdvance = await advanceAfterPeriodicSubmit(client, orderTestId, resultUpper, testerId);

      let fallbackNextId = periodicAdvance?.nextArticleTestId ?? null;
      if (fallbackNextId) {
        await client.query(
          `UPDATE article_tests
           SET assigned_tester_id = $1,
               assigned_at = COALESCE(assigned_at, NOW()),
               status = CASE WHEN status = 'pending' THEN 'assigned' ELSE status END,
               updated_at = NOW()
           WHERE id = $2`,
          [testerId, fallbackNextId]
        );
        await client.query(
          `UPDATE periodic_test_runs
           SET assigned_tester_id = $1,
               updated_at = NOW()
           WHERE article_test_id = $2`,
          [testerId, fallbackNextId]
        );
      }
      if (!fallbackNextId && t.periodic_schedule_id && t.periodic_run_number != null) {
        const nextRunNo = Number(t.periodic_run_number) + 1;
        const existingNext = await client.query(
          `SELECT id, assigned_tester_id
           FROM article_tests
           WHERE periodic_schedule_id = $1 AND periodic_run_number = $2
           ORDER BY created_at DESC
           LIMIT 1`,
          [t.periodic_schedule_id, nextRunNo]
        );
        if (existingNext.rows.length > 0) {
          fallbackNextId = existingNext.rows[0].id;
          if (existingNext.rows[0].assigned_tester_id == null || Number(existingNext.rows[0].assigned_tester_id) !== Number(testerId)) {
            await client.query(
              `UPDATE article_tests
               SET assigned_tester_id = $1,
                   assigned_at = COALESCE(assigned_at, NOW()),
                   status = CASE WHEN status = 'pending' THEN 'assigned' ELSE status END,
                   updated_at = NOW()
               WHERE id = $2`,
              [testerId, fallbackNextId]
            );
            await client.query(
              `UPDATE periodic_test_runs
               SET assigned_tester_id = $1,
                   updated_at = NOW()
               WHERE article_test_id = $2`,
              [testerId, fallbackNextId]
            );
          }
        }
      }
      await client.query('COMMIT');

      return res.json({
        message: (periodicAdvance?.nextArticleTestId || fallbackNextId)
          ? 'Next periodic cycle created'
          : 'No new cycle created',
        periodicNextTestId: periodicAdvance?.nextArticleTestId ?? fallbackNextId,
        periodicScheduleEnded: Boolean(periodicAdvance?.scheduleEnded),
        periodicAdvanced: Boolean(periodicAdvance?.advanced)
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Advance periodic cycle error:', error);
    res.status(500).json({ error: 'Failed to create next periodic cycle' });
  }
});

router.post('/my-tests/:orderTestId/photos', upload.single('photo'), async (req, res) => {
  try {
    const { orderTestId } = req.params;
    const testerId = resolveTesterId(req);
    if (!testerId) return res.status(400).json({ error: 'Valid tester ID is required' });
    if (!req.file) return res.status(400).json({ error: 'Photo file is required' });

    const slot = Number(req.body.slot);
    const label = String(req.body.label || '').trim();
    if (!Number.isInteger(slot) || slot < 1) {
      return res.status(400).json({ error: 'Valid slot number is required' });
    }

    const { pool } = require('../config/database');
    const client = await pool.connect();
    try {
      const own = await client.query(
        `SELECT id, inhouse_test_id, result_data FROM article_tests WHERE id = $1 AND assigned_tester_id = $2 AND execution_type IN ('inhouse', 'both') AND status IN ('in_progress','assigned','pending')`,
        [orderTestId, testerId]
      );
      if (own.rows.length === 0) {
        return res.status(404).json({ error: 'Test not found, not editable, or not assigned to you' });
      }

      const row = own.rows[0];
      const inhouseId = String(row.inhouse_test_id || '').toUpperCase();
      const rule = PHOTO_RULES[inhouseId] || { min: 0, max: 3, required: false };

      const resultData = row.result_data && typeof row.result_data === 'object' ? row.result_data : {};
      const existingPhotos = Array.isArray(resultData.photos) ? resultData.photos : [];
      const withoutSlot = existingPhotos.filter((p) => Number(p.slot) !== slot);
      if (withoutSlot.length >= rule.max) {
        return res.status(400).json({ error: `Maximum ${rule.max} photos allowed for this test` });
      }

      const ext = req.file.mimetype === 'image/png' ? '.png' : '.jpg';
      const uploadsDir = path.resolve(__dirname, '..', 'uploads', 'tests', orderTestId);
      await ensureDir(uploadsDir);
      const fileName = `photo_${slot}${ext}`;
      const filePath = path.join(uploadsDir, fileName);
      await fs.writeFile(filePath, req.file.buffer);
      const fileUrl = `/uploads/tests/${orderTestId}/${fileName}`;

      const nextPhotos = [
        ...withoutSlot,
        {
          slot,
          label: label || `Photo ${slot}`,
          url: fileUrl,
          uploaded_at: new Date().toISOString()
        }
      ].sort((a, b) => Number(a.slot) - Number(b.slot));

      const nextResultData = { ...resultData, photos: nextPhotos };
      await client.query(
        `UPDATE article_tests SET result_data = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(nextResultData), orderTestId]
      );

      res.json({ message: 'Photo uploaded', photo: nextPhotos.find((p) => Number(p.slot) === slot), photos: nextPhotos });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Photo upload error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload photo' });
  }
});

router.delete('/my-tests/:orderTestId/photos/:slot', async (req, res) => {
  try {
    const { orderTestId, slot } = req.params;
    const testerId = resolveTesterId(req);
    if (!testerId) return res.status(400).json({ error: 'Valid tester ID is required' });
    const slotNum = Number(slot);
    if (!Number.isInteger(slotNum) || slotNum < 1) return res.status(400).json({ error: 'Invalid slot number' });

    const { pool } = require('../config/database');
    const client = await pool.connect();
    try {
      const own = await client.query(
        `SELECT id, result_data FROM article_tests WHERE id = $1 AND assigned_tester_id = $2 AND execution_type IN ('inhouse', 'both') AND status IN ('in_progress','assigned','pending')`,
        [orderTestId, testerId]
      );
      if (own.rows.length === 0) {
        return res.status(404).json({ error: 'Test not found, not editable, or not assigned to you' });
      }

      const row = own.rows[0];
      const resultData = row.result_data && typeof row.result_data === 'object' ? row.result_data : {};
      const photos = Array.isArray(resultData.photos) ? resultData.photos : [];
      const existing = photos.find((p) => Number(p.slot) === slotNum);
      const nextPhotos = photos.filter((p) => Number(p.slot) !== slotNum);

      const nextResultData = { ...resultData, photos: nextPhotos };
      await client.query(`UPDATE article_tests SET result_data = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(nextResultData), orderTestId]);
      if (existing?.url?.startsWith('/uploads/')) {
        const abs = path.resolve(__dirname, '..', existing.url.replace(/^\//, ''));
        await fs.unlink(abs).catch(() => {});
      }

      res.json({ message: 'Photo removed', photos: nextPhotos });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Photo delete error:', error);
    res.status(500).json({ error: 'Failed to remove photo' });
  }
});

module.exports = router;
