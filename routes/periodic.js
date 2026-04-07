const express = require('express');
const dbAdapter = require('../config/dbAdapter');

const router = express.Router();

function resolveFrequencyValue(frequencyType, frequencyValue) {
  const t = String(frequencyType || '').toLowerCase();
  if (t === 'custom') return Math.min(365, Math.max(1, Number(frequencyValue) || 1));
  const map = { daily: 1, weekly: 7, fortnightly: 14, monthly: 30, quarterly: 90 };
  return map[t] || 1;
}

/**
 * POST /api/periodic/schedules
 * Body: articleTestId, frequencyType, frequencyValue?, totalOccurrences? | indefinite,
 *       scheduleStartDate, alertDaysBefore, assignedTesterId, notes?, createdBy?
 */
router.post('/schedules', async (req, res) => {
  try {
    const {
      articleTestId,
      frequencyType,
      frequencyValue,
      totalOccurrences,
      indefinite,
      scheduleStartDate,
      alertDaysBefore,
      assignedTesterId,
      notes,
      createdBy
    } = req.body;

    if (!articleTestId || !frequencyType || !scheduleStartDate) {
      return res.status(400).json({ error: 'articleTestId, frequencyType, and scheduleStartDate are required' });
    }

    const tests = await dbAdapter.query(
      `SELECT at.*, a.client_id, a.id AS article_pk
       FROM article_tests at
       JOIN articles a ON a.id = at.article_id
       WHERE at.id = $1`,
      [articleTestId]
    );
    if (tests.length === 0) {
      return res.status(404).json({ error: 'Article test not found' });
    }
    const row = tests[0];
    if (String(row.execution_type) !== 'inhouse' && String(row.execution_type) !== 'both') {
      return res.status(400).json({ error: 'Periodic schedules are only available for in-house (or both) tests' });
    }
    if (row.periodic_schedule_id) {
      return res.status(400).json({ error: 'This test already belongs to a periodic schedule' });
    }
    const dup = await dbAdapter.query(
      `SELECT id FROM periodic_schedules WHERE source_article_test_id = $1 LIMIT 1`,
      [articleTestId]
    );
    if (dup.length > 0) {
      return res.status(400).json({ error: 'A periodic schedule already exists for this test' });
    }

    const fv = resolveFrequencyValue(frequencyType, frequencyValue);
    const total = indefinite ? null : Math.max(1, Number(totalOccurrences) || 1);
    const start = String(scheduleStartDate).slice(0, 10);
    const alertDays = Math.min(30, Math.max(1, Number(alertDaysBefore) || 3));
    const adminId = createdBy || 1;

    const result = await dbAdapter.transaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO periodic_schedules (
          source_article_test_id, article_id, client_id, test_name, test_standard,
          inhouse_test_id, client_requirement, is_active, schedule_status,
          frequency_type, frequency_value, total_occurrences, completed_occurrences,
          schedule_start_date, next_due_date, assigned_tester_id, alert_days_before,
          created_by, notes
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, true, 'active',
          $8, $9, $10, 0, $11, $11, $12, $13, $14, $15
        ) RETURNING *`,
        [
          articleTestId,
          row.article_id,
          row.client_id,
          row.test_name,
          row.test_standard,
          row.inhouse_test_id,
          row.client_requirement,
          String(frequencyType).toLowerCase(),
          fv,
          total,
          start,
          assignedTesterId || row.assigned_tester_id || null,
          alertDays,
          adminId,
          notes || null
        ]
      );
      const schedule = ins.rows[0];

      await client.query(
        `UPDATE article_tests SET
          is_periodic = true,
          periodic_schedule_id = $1,
          periodic_run_number = 1,
          updated_at = NOW()
        WHERE id = $2`,
        [schedule.id, articleTestId]
      );

      await client.query(
        `INSERT INTO periodic_test_runs (
          schedule_id, run_number, article_test_id, assigned_tester_id, due_date, status
        ) VALUES ($1, 1, $2, $3, $4, 'scheduled')`,
        [schedule.id, articleTestId, assignedTesterId || row.assigned_tester_id || null, start]
      );

      return schedule;
    });

    res.status(201).json({ message: 'Periodic schedule created', schedule: result });
  } catch (error) {
    console.error('Create periodic schedule error:', error);
    res.status(500).json({ error: error.message || 'Failed to create schedule' });
  }
});

/** GET /api/periodic/schedules?articleId= — optional filter by article */
router.get('/schedules', async (req, res) => {
  try {
    const { articleId } = req.query;
    const params = [];
    let where = '';
    if (articleId) {
      params.push(articleId);
      where = `WHERE ps.article_id = $${params.length}`;
    }
    const rows = await dbAdapter.query(
      `
      SELECT ps.*,
        c.company_name AS client_name,
        a.article_number,
        a.article_name
      FROM periodic_schedules ps
      JOIN clients c ON c.id = ps.client_id
      JOIN articles a ON a.id = ps.article_id
      ${where}
      ORDER BY ps.next_due_date ASC NULLS LAST
    `,
      params
    );
    res.json(rows);
  } catch (error) {
    console.error('List periodic schedules error:', error);
    res.status(500).json({ error: 'Failed to list schedules' });
  }
});

/** GET /api/periodic/schedules/:id — single schedule with client/article names */
router.get('/schedules/:id/detail', async (req, res) => {
  try {
    const rows = await dbAdapter.query(
      `
      SELECT ps.*,
        c.company_name AS client_name,
        a.article_number,
        a.article_name
      FROM periodic_schedules ps
      JOIN clients c ON c.id = ps.client_id
      JOIN articles a ON a.id = ps.article_id
      WHERE ps.id = $1
    `,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Get schedule detail error:', error);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

/** GET /api/periodic/schedules/:id/runs */
router.get('/schedules/:id/runs', async (req, res) => {
  try {
    const runs = await dbAdapter.query(
      `SELECT ptr.*, u.name AS tester_name,
              at.report_url AS article_report_url,
              at.report_number AS article_report_number,
              at.report_generated_at AS article_report_generated_at,
              at.status AS article_test_status
       FROM periodic_test_runs ptr
       LEFT JOIN users u ON u.id = ptr.assigned_tester_id
       LEFT JOIN article_tests at ON at.id = ptr.article_test_id
       WHERE ptr.schedule_id = $1
       ORDER BY ptr.run_number ASC`,
      [req.params.id]
    );
    res.json(runs);
  } catch (error) {
    console.error('List runs error:', error);
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

/** PATCH /api/periodic/schedules/:id — pause / resume / end */
router.patch('/schedules/:id', async (req, res) => {
  try {
    const { scheduleStatus, isActive } = req.body;
    const updates = [];
    const vals = [];
    let i = 1;
    if (scheduleStatus) {
      updates.push(`schedule_status = $${i++}`);
      vals.push(scheduleStatus);
    }
    if (typeof isActive === 'boolean') {
      updates.push(`is_active = $${i++}`);
      vals.push(isActive);
    }
    if (!updates.length) return res.status(400).json({ error: 'No updates' });
    updates.push('updated_at = NOW()');
    vals.push(req.params.id);
    await dbAdapter.execute(
      `UPDATE periodic_schedules SET ${updates.join(', ')} WHERE id = $${i}`,
      vals
    );
    res.json({ message: 'Schedule updated' });
  } catch (error) {
    console.error('Patch schedule error:', error);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

module.exports = router;
