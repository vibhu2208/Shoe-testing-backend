const express = require('express');
const router = express.Router();
const dbAdapter = require('../config/dbAdapter');
const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');
const XLSX = require('xlsx');
const { buildCoaDocBuffer } = require('../services/coaReportGenerator');
const { pool } = require('../config/database');
const { advanceAfterPeriodicSubmit } = require('../services/periodicService');
const upload = multer({ storage: multer.memoryStorage() });

const normalizeCell = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const parseBulkRowsFromBuffer = (file) => {
  if (!file || !file.buffer) {
    throw new Error('File is required');
  }

  const workbook = XLSX.read(file.buffer, { type: 'buffer' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) {
    throw new Error('No worksheet found in uploaded file');
  }

  const sheet = workbook.Sheets[firstSheet];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
};

const createArticleWithTests = async ({
  clientId = null,
  articleNumber,
  articleName,
  materialType,
  color,
  description,
  specifications,
  tests
}) => {
  if (!articleNumber || !String(articleNumber).trim() || !articleName || !String(articleName).trim()) {
    const error = new Error('articleNumber and articleName are required');
    error.statusCode = 400;
    throw error;
  }

  return dbAdapter.transaction(async (client) => {
    const articleResult = await client.query(`
      INSERT INTO articles (
        client_id, article_number, article_name, material_type,
        color, description, specifications, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
      RETURNING id, client_id, article_number, created_at
    `, [
      clientId,
      String(articleNumber).trim(),
      String(articleName).trim(),
      materialType || null,
      color || null,
      description || null,
      JSON.stringify(specifications || null)
    ]);

    const newArticle = articleResult.rows[0];

    if (tests && tests.length > 0) {
      const batchNumber = `BATCH-${String(Date.now()).slice(-6)}`;

      const batchResult = await client.query(`
        INSERT INTO test_batches (article_id, batch_number, notes, status)
        VALUES ($1, $2, $3, 'active') RETURNING id
      `, [newArticle.id, batchNumber, 'Initial test batch']);

      const batchId = batchResult.rows[0].id;

      for (const test of tests) {
        await client.query(`
          INSERT INTO article_tests (
            article_id, batch_id, test_name, test_standard, client_requirement,
            category, execution_type, inhouse_test_id, vendor_name, vendor_contact,
            vendor_email, expected_report_date, assigned_tester_id, test_deadline,
            assigned_at, assigned_by, notes, status
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
          )
        `, [
          newArticle.id,
          batchId,
          test.testName || test.test_name,
          test.standard || test.standard_method,
          test.clientRequirement || test.client_requirement,
          test.category,
          test.executionType || test.execution_type,
          test.inhouseTestId || test.inhouse_test_id,
          test.vendorName || test.vendor_name,
          test.vendorContact || test.vendor_contact,
          test.vendorEmail || test.vendor_email,
          test.expectedReportDate || test.expected_report_date,
          test.assignedTesterId || test.assigned_tester_id || null,
          test.testDeadline || test.test_deadline || null,
          test.assignedTesterId || test.assigned_tester_id ? new Date() : null,
          test.assignedTesterId || test.assigned_tester_id ? 1 : null,
          test.notes || null,
          test.assignedTesterId || test.assigned_tester_id ? 'assigned' : 'pending'
        ]);
      }
    }

    return newArticle;
  });
};

// Get all articles for a client
router.get('/clients/:clientId/articles', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const articles = await dbAdapter.query(`
      SELECT 
        a.*,
        COUNT(DISTINCT at.id) as total_tests,
        COUNT(DISTINCT tb.id) as total_batches,
        COUNT(CASE WHEN at.status IN ('submitted', 'pass', 'fail') THEN 1 END) as completed_tests
      FROM articles a
      LEFT JOIN article_tests at ON a.id = at.article_id
      LEFT JOIN test_batches tb ON a.id = tb.article_id
      WHERE a.client_id = $1
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `, [clientId]);
    
    res.json(articles);
  } catch (error) {
    console.error('Error fetching articles:', error);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

router.get('/clients/:clientId/articles/bulk-template', (req, res) => {
  const headers = [
    'articleNumber',
    'articleName',
    'materialType',
    'color',
    'description',
    'testName',
    'standard',
    'clientRequirement',
    'category',
    'executionType',
    'inhouseTestId',
    'vendorName',
    'vendorContact',
    'vendorEmail',
    'expectedReportDate',
    'testDeadline',
    'notes'
  ];

  const example = [{
    articleNumber: 'ART-001',
    articleName: 'Runner Shoe Model X',
    materialType: 'Synthetic',
    color: 'Black',
    description: 'Sports shoe upper and sole assembly',
    testName: 'Sole Abrasion',
    standard: 'SATRA-TM-174',
    clientRequirement: 'Max wear <= 200 mm3',
    category: 'Finished Good',
    executionType: 'inhouse',
    inhouseTestId: 'SATRA-TM-174',
    vendorName: '',
    vendorContact: '',
    vendorEmail: '',
    expectedReportDate: '',
    testDeadline: '2026-04-10',
    notes: 'Priority sample'
  }];

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(example, { header: headers });
  XLSX.utils.book_append_sheet(workbook, sheet, 'articles');
  const fileBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="articles_bulk_template.xlsx"');
  res.send(fileBuffer);
});

router.post('/clients/:clientId/articles/bulk-upload', upload.single('file'), async (req, res) => {
  try {
    const { clientId } = req.params;
    const rows = parseBulkRowsFromBuffer(req.file);
    if (!rows.length) {
      return res.status(400).json({ error: 'No rows found in uploaded file' });
    }

    const groupedByArticle = new Map();
    rows.forEach((row, index) => {
      const articleNumber = normalizeCell(row.articleNumber);
      const articleName = normalizeCell(row.articleName);
      if (!articleNumber || !articleName) {
        throw new Error(`Row ${index + 2}: articleNumber and articleName are required`);
      }

      const articleKey = `${articleNumber}__${articleName}`;
      if (!groupedByArticle.has(articleKey)) {
        groupedByArticle.set(articleKey, {
          articleNumber,
          articleName,
          materialType: normalizeCell(row.materialType),
          color: normalizeCell(row.color),
          description: normalizeCell(row.description),
          tests: []
        });
      }

      const testName = normalizeCell(row.testName);
      if (testName) {
        groupedByArticle.get(articleKey).tests.push({
          testName,
          standard: normalizeCell(row.standard),
          clientRequirement: normalizeCell(row.clientRequirement),
          category: normalizeCell(row.category) || 'Finished Good',
          executionType: (() => {
            const executionType = normalizeCell(row.executionType).toLowerCase();
            if (executionType === 'outsource') return 'outsource';
            if (executionType === 'both') return 'both';
            return 'inhouse';
          })(),
          inhouseTestId: normalizeCell(row.inhouseTestId) || null,
          vendorName: normalizeCell(row.vendorName) || null,
          vendorContact: normalizeCell(row.vendorContact) || null,
          vendorEmail: normalizeCell(row.vendorEmail) || null,
          expectedReportDate: normalizeCell(row.expectedReportDate) || null,
          testDeadline: normalizeCell(row.testDeadline) || null,
          notes: normalizeCell(row.notes) || null
        });
      }
    });

    const createdArticles = await dbAdapter.transaction(async (client) => {
      const created = [];
      for (const article of groupedByArticle.values()) {
        const articleResult = await client.query(`
          INSERT INTO articles (
            client_id, article_number, article_name, material_type,
            color, description, specifications, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
          RETURNING id, article_number
        `, [
          clientId,
          article.articleNumber,
          article.articleName,
          article.materialType || null,
          article.color || null,
          article.description || null,
          JSON.stringify(null)
        ]);

        const newArticle = articleResult.rows[0];
        created.push(newArticle);

        if (article.tests.length > 0) {
          const batchNumber = `BATCH-${String(Date.now()).slice(-6)}-${newArticle.id}`;
          const batchResult = await client.query(`
            INSERT INTO test_batches (article_id, batch_number, notes, status)
            VALUES ($1, $2, $3, 'active') RETURNING id
          `, [newArticle.id, batchNumber, 'Bulk upload initial test batch']);
          const batchId = batchResult.rows[0].id;

          for (const test of article.tests) {
            await client.query(`
              INSERT INTO article_tests (
                article_id, batch_id, test_name, test_standard, client_requirement,
                category, execution_type, inhouse_test_id, vendor_name, vendor_contact,
                vendor_email, expected_report_date, assigned_tester_id, test_deadline,
                assigned_at, assigned_by, notes, status
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
              )
            `, [
              newArticle.id,
              batchId,
              test.testName,
              test.standard || null,
              test.clientRequirement || null,
              test.category,
              test.executionType,
              test.inhouseTestId,
              test.vendorName,
              test.vendorContact,
              test.vendorEmail,
              test.expectedReportDate,
              null,
              test.testDeadline,
              null,
              null,
              test.notes,
              'pending'
            ]);
          }
        }
      }
      return created;
    });

    res.status(201).json({
      message: 'Articles uploaded successfully',
      createdCount: createdArticles.length,
      articles: createdArticles
    });
  } catch (error) {
    console.error('Error bulk uploading articles:', error);
    res.status(400).json({ error: error.message || 'Failed to bulk upload articles' });
  }
});

// Get article by ID with full details
router.get('/articles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get article details
    const articles = await dbAdapter.query(
      'SELECT * FROM articles WHERE id = $1',
      [id]
    );
    
    if (articles.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }
    
    // Get test batches
    const batches = await dbAdapter.query(
      'SELECT * FROM test_batches WHERE article_id = $1 ORDER BY created_at DESC',
      [id]
    );
    
    // Get all tests for this article
    const tests = await dbAdapter.query(`
      SELECT 
        at.*,
        tb.batch_number,
        u.name as tester_name,
        u.department as tester_department
      FROM article_tests at
      LEFT JOIN test_batches tb ON at.batch_id = tb.id
      LEFT JOIN users u ON at.assigned_tester_id = u.id
      WHERE at.article_id = $1
      ORDER BY at.created_at DESC
    `, [id]);
    
    const article = {
      ...articles[0],
      batches,
      tests
    };
    
    res.json(article);
  } catch (error) {
    console.error('Error fetching article:', error);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

// Create new article
router.post('/clients/:clientId/articles', async (req, res) => {
  try {
    const { clientId } = req.params;
    const {
      articleNumber,
      articleName,
      materialType,
      color,
      description,
      specifications,
      tests
    } = req.body;
    
    console.log('📦 Creating new article for client:', clientId);
    console.log('📋 Article data:', { articleNumber, articleName, testsCount: tests?.length });
    
    const result = await createArticleWithTests({
      clientId,
      articleNumber,
      articleName,
      materialType,
      color,
      description,
      specifications,
      tests
    });
    
    res.status(201).json({
      message: 'Article created successfully',
      article: result
    });
  } catch (error) {
    console.error('❌ Error creating article:', error);
    if (error.code === '23505') { // Unique constraint violation
      res.status(400).json({ error: 'Article number already exists for this client' });
    } else if (error.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to create article' });
    }
  }
});

// Create new article without linking to client
router.post('/articles', async (req, res) => {
  try {
    const {
      articleNumber,
      articleName,
      materialType,
      color,
      description,
      specifications,
      tests,
      clientId
    } = req.body;

    console.log('📦 Creating standalone article');
    const result = await createArticleWithTests({
      clientId: clientId || null,
      articleNumber,
      articleName,
      materialType,
      color,
      description,
      specifications,
      tests
    });

    res.status(201).json({
      message: 'Article created successfully',
      article: result
    });
  } catch (error) {
    console.error('❌ Error creating standalone article:', error);
    if (error.code === '23505') {
      res.status(400).json({ error: 'Article number already exists' });
    } else if (error.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to create article' });
    }
  }
});

// Update article
router.put('/articles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      articleName,
      materialType,
      color,
      description,
      specifications,
      status
    } = req.body;
    
    await dbAdapter.execute(`
      UPDATE articles SET
        article_name = $1,
        material_type = $2,
        color = $3,
        description = $4,
        specifications = $5,
        status = $6,
        updated_at = NOW()
      WHERE id = $7
    `, [articleName, materialType, color, description, JSON.stringify(specifications), status, id]);
    
    res.json({ message: 'Article updated successfully' });
  } catch (error) {
    console.error('Error updating article:', error);
    res.status(500).json({ error: 'Failed to update article' });
  }
});

// Get article tests
router.get('/articles/:id/tests', async (req, res) => {
  try {
    const { id } = req.params;
    const { batchId } = req.query;
    
    let query = `
      SELECT 
        at.*,
        tb.batch_number,
        u.name as tester_name,
        u.department as tester_department
      FROM article_tests at
      LEFT JOIN test_batches tb ON at.batch_id = tb.id
      LEFT JOIN users u ON at.assigned_tester_id = u.id
      WHERE at.article_id = $1
    `;
    
    const params = [id];
    
    if (batchId) {
      query += ' AND at.batch_id = $2';
      params.push(batchId);
    }
    
    query += ' ORDER BY at.created_at DESC';
    
    const tests = await dbAdapter.query(query, params);
    res.json(tests);
  } catch (error) {
    console.error('Error fetching article tests:', error);
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
});

// Create new test batch for article
router.post('/articles/:id/batches', async (req, res) => {
  try {
    const { id } = req.params;
    const { batchNumber, notes, tests } = req.body;
    
    const result = await dbAdapter.transaction(async (client) => {
      // Create new batch
      const batchResult = await client.query(`
        INSERT INTO test_batches (article_id, batch_number, notes, status)
        VALUES ($1, $2, $3, 'active') RETURNING id, batch_number, created_at
      `, [id, batchNumber, notes]);
      
      const newBatch = batchResult.rows[0];
      
      // Add tests to batch if provided
      if (tests && tests.length > 0) {
        for (const test of tests) {
          await client.query(`
            INSERT INTO article_tests (
              article_id, batch_id, test_name, test_standard, client_requirement,
              category, execution_type, inhouse_test_id, vendor_name, vendor_contact,
              vendor_email, expected_report_date, notes, status
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending'
            )
          `, [
            id, newBatch.id, test.testName, test.standard, test.clientRequirement,
            test.category, test.executionType, test.inhouseTestId, test.vendorName,
            test.vendorContact, test.vendorEmail, test.expectedReportDate, test.notes
          ]);
        }
      }
      
      return newBatch;
    });
    
    res.status(201).json({
      message: 'Test batch created successfully',
      batch: result
    });
  } catch (error) {
    console.error('Error creating test batch:', error);
    res.status(500).json({ error: 'Failed to create test batch' });
  }
});

// Get article batches
router.get('/articles/:id/batches', async (req, res) => {
  try {
    const { id } = req.params;
    
    const batches = await dbAdapter.query(`
      SELECT 
        tb.*,
        COUNT(at.id) as test_count,
        COUNT(CASE WHEN at.status IN ('submitted', 'pass', 'fail') THEN 1 END) as completed_tests
      FROM test_batches tb
      LEFT JOIN article_tests at ON tb.id = at.batch_id
      WHERE tb.article_id = $1
      GROUP BY tb.id
      ORDER BY tb.created_at DESC
    `, [id]);
    
    res.json(batches);
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

// Update article test
router.put('/article-tests/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const updates = { ...req.body };

    // Keep status aligned with tester assignment in autosave/edit flows.
    // If tester is selected -> assigned (unless already in-progress/submitted/pass/fail).
    // If tester is removed while status is assigned -> pending.
    if (Object.prototype.hasOwnProperty.call(updates, 'assigned_tester_id')) {
      const hasTester = updates.assigned_tester_id !== null && updates.assigned_tester_id !== '';
      const currentRows = await dbAdapter.query('SELECT status FROM article_tests WHERE id = $1', [testId]);
      const currentStatus = currentRows[0]?.status || 'pending';

      if (hasTester && ['pending', 'assigned'].includes(currentStatus) && !Object.prototype.hasOwnProperty.call(updates, 'status')) {
        updates.status = 'assigned';
      }

      if (!hasTester && currentStatus === 'assigned' && !Object.prototype.hasOwnProperty.call(updates, 'status')) {
        updates.status = 'pending';
      }
    }
    
    // Build dynamic UPDATE query with only provided fields
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    // Only update fields that are actually provided in the request
    const allowedFields = [
      'test_name', 'test_standard', 'client_requirement', 'category', 
      'execution_type', 'status', 'inhouse_test_id', 'vendor_name', 
      'vendor_contact', 'vendor_email', 'expected_report_date', 
      'assigned_tester_id', 'test_deadline', 'notes', 'result', 'result_data'
    ];
    
    for (const field of allowedFields) {
      if (updates.hasOwnProperty(field)) {
        // Skip empty test_name to prevent constraint violation
        if (field === 'test_name' && (!updates[field] || updates[field].trim() === '')) {
          console.warn('Skipping empty test_name update');
          continue;
        }
        
        updateFields.push(`${field} = $${paramCount}`);
        values.push(updates[field]);
        paramCount++;
      }
    }
    
    // Always update the timestamp
    updateFields.push(`updated_at = NOW()`);
    
    if (updateFields.length === 1) { // Only timestamp update
      return res.json({ message: 'No valid fields to update' });
    }
    
    const query = `
      UPDATE article_tests SET
        ${updateFields.join(', ')}
      WHERE id = $${paramCount}
    `;
    
    values.push(testId);
    
    console.log('Executing update query:', query);
    console.log('With values:', values);
    
    await dbAdapter.execute(query, values);
    
    res.json({ message: 'Test updated successfully' });
  } catch (error) {
    console.error('Error updating test:', error);
    res.status(500).json({ error: 'Failed to update test' });
  }
});

// Assign tester to article test
router.post('/article-tests/:testId/assign', async (req, res) => {
  try {
    const { testId } = req.params;
    const { tester_id, deadline, notes } = req.body;
    
    const assigned_by = 1; // Admin user ID
    
    await dbAdapter.execute(`
      UPDATE article_tests SET
        assigned_tester_id = $1,
        test_deadline = $2,
        assigned_at = NOW(),
        assigned_by = $3,
        notes = $4,
        status = CASE 
          WHEN $1 IS NOT NULL THEN 'assigned'
          ELSE status
        END
      WHERE id = $5
    `, [tester_id, deadline, assigned_by, notes, testId]);
    
    res.json({ message: 'Test assigned successfully' });
  } catch (error) {
    console.error('Error assigning test:', error);
    res.status(500).json({ error: 'Failed to assign test' });
  }
});

// Submit test results
router.put('/article-tests/:testId/results', async (req, res) => {
  const { testId } = req.params;
  const { result, resultData } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE article_tests 
       SET result = $1, result_data = $2, status = 'submitted', submitted_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [result, JSON.stringify(resultData), testId]
    );
    try {
      await advanceAfterPeriodicSubmit(client, testId, result);
    } catch (periodicErr) {
      if (periodicErr.code === '42P01') {
        console.warn('Periodic tables not installed; skipping advance:', periodicErr.message);
      } else {
        throw periodicErr;
      }
    }
    await client.query('COMMIT');
    res.json({ message: 'Test results submitted successfully' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error submitting test results:', error);
    res.status(500).json({ error: 'Failed to submit test results' });
  } finally {
    client.release();
  }
});

// Get all articles across clients (for dashboard)
router.get('/articles', async (req, res) => {
  try {
    const articles = await dbAdapter.query(`
      SELECT 
        a.*,
        c.company_name as client_name,
        COUNT(DISTINCT at.id) as total_tests,
        COUNT(DISTINCT tb.id) as total_batches,
        COUNT(CASE WHEN at.status IN ('submitted', 'pass', 'fail') THEN 1 END) as completed_tests
      FROM articles a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN article_tests at ON a.id = at.article_id
      LEFT JOIN test_batches tb ON a.id = tb.article_id
      WHERE a.status = 'active'
      GROUP BY a.id, c.company_name
      ORDER BY a.created_at DESC
    `);
    
    res.json(articles);
  } catch (error) {
    console.error('Error fetching articles:', error);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

const ensureReportTablesSql = `
CREATE TABLE IF NOT EXISTS report_sequence (
  id SERIAL PRIMARY KEY,
  year INTEGER UNIQUE NOT NULL,
  last_sequence_number INTEGER NOT NULL DEFAULT 0
);
`;

async function ensureReportColumns(client) {
  await client.query(`
    ALTER TABLE article_tests
    ADD COLUMN IF NOT EXISTS report_generated BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS report_url TEXT,
    ADD COLUMN IF NOT EXISTS report_generated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS report_number VARCHAR(255)
  `);
}

async function nextReportNumber(client, testName) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const fyStart = yy;
  const fyEnd = String((Number(yy) + 1) % 100).padStart(2, '0');
  const yearKey = now.getFullYear();

  await client.query(ensureReportTablesSql);

  // Avoid relying on ON CONFLICT(year): some existing DBs may miss a unique
  // constraint on report_sequence.year and would raise 42P10.
  const existingRow = await client.query(
    `SELECT id, last_sequence_number
     FROM report_sequence
     WHERE year = $1
     ORDER BY id ASC
     LIMIT 1
     FOR UPDATE`,
    [yearKey]
  );

  let rowId;
  if (existingRow.rows.length === 0) {
    const inserted = await client.query(
      `INSERT INTO report_sequence (year, last_sequence_number)
       VALUES ($1, 0)
       RETURNING id`,
      [yearKey]
    );
    rowId = inserted.rows[0].id;
  } else {
    rowId = existingRow.rows[0].id;
  }

  const seqResult = await client.query(
    `UPDATE report_sequence
     SET last_sequence_number = last_sequence_number + 1
     WHERE id = $1
     RETURNING last_sequence_number`,
    [rowId]
  );
  const seq = Number(seqResult.rows[0].last_sequence_number);
  return `${seq}-${fyStart}-${fyEnd} ${String(testName || '').toUpperCase()}`;
}

async function generateAndPersistReport({ testId, forceRegenerate = false }) {
  const { pool } = require('../config/database');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureReportColumns(client);

    const query = await client.query(
      `SELECT
        at.*,
        a.id AS article_id,
        a.article_name,
        a.article_number,
        a.material_type,
        a.color,
        c.id AS client_id,
        c.client_code
      FROM article_tests at
      JOIN articles a ON a.id = at.article_id
      LEFT JOIN clients c ON c.id = a.client_id
      WHERE at.id = $1`,
      [testId]
    );
    if (query.rows.length === 0) {
      throw new Error('Test not found');
    }

    const t = query.rows[0];
    const exec = String(t.execution_type || '').toLowerCase();
    if (exec !== 'inhouse' && exec !== 'both') {
      throw new Error('Generate Report is only available for in-house or combined (both) tests');
    }
    if (t.status !== 'submitted') {
      throw new Error('Report can be generated only after tester submission');
    }
    if (t.report_generated && !forceRegenerate && t.report_url) {
      await client.query('COMMIT');
      return { reportUrl: t.report_url, reportNumber: t.report_number, alreadyGenerated: true };
    }

    const reportNumber = t.report_number || (await nextReportNumber(client, t.test_name));
    const submittedDate = t.submitted_at
      ? new Date(t.submitted_at).toLocaleDateString('en-GB').replace(/\//g, '-')
      : new Date().toLocaleDateString('en-GB').replace(/\//g, '-');

    const docBuffer = await buildCoaDocBuffer({
      ...t,
      report_number: reportNumber,
      submitted_date: submittedDate
    });

    const safeReportName = reportNumber.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
    const reportClientDir = t.client_id ? String(t.client_id) : 'unassigned';
    const relDir = path.join('reports', reportClientDir, String(t.article_id), String(t.id));
    const absDir = path.resolve(__dirname, '..', relDir);
    await fs.mkdir(absDir, { recursive: true });
    const fileName = `CoA_${safeReportName}.docx`;
    const absPath = path.join(absDir, fileName);
    await fs.writeFile(absPath, docBuffer);
    const reportUrl = `/${path.join(relDir, fileName).replace(/\\/g, '/')}`;

    await client.query(
      `UPDATE article_tests
       SET report_generated = true,
           report_url = $1,
           report_generated_at = NOW(),
           report_number = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [reportUrl, reportNumber, testId]
    );

    try {
      await client.query(
        `UPDATE periodic_test_runs SET report_url = $1, updated_at = NOW() WHERE article_test_id = $2`,
        [reportUrl, testId]
      );
    } catch (syncErr) {
      if (syncErr.code !== '42P01' && syncErr.code !== '42703') {
        throw syncErr;
      }
    }

    await client.query('COMMIT');
    return { reportUrl, reportNumber, alreadyGenerated: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

router.post('/article-tests/:testId/generate-report', async (req, res) => {
  try {
    const result = await generateAndPersistReport({ testId: req.params.testId, forceRegenerate: false });
    res.json(result);
  } catch (error) {
    console.error('Generate report error:', error);
    res.status(400).json({ error: error.message || 'Failed to generate report' });
  }
});

router.post('/article-tests/:testId/regenerate-report', async (req, res) => {
  try {
    const result = await generateAndPersistReport({ testId: req.params.testId, forceRegenerate: true });
    res.json(result);
  } catch (error) {
    console.error('Regenerate report error:', error);
    res.status(400).json({ error: error.message || 'Failed to regenerate report' });
  }
});

router.get('/article-tests/:testId/download-report', async (req, res) => {
  try {
    const rows = await dbAdapter.query(`SELECT report_url, report_number FROM article_tests WHERE id = $1`, [req.params.testId]);
    if (!rows.length || !rows[0].report_url) {
      return res.status(404).json({ error: 'Report not generated yet' });
    }
    const reportUrl = rows[0].report_url;
    const absPath = path.resolve(__dirname, '..', reportUrl.replace(/^\//, ''));
    await fs.access(absPath);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="CoA_${String(rows[0].report_number || 'report').replace(/"/g, '')}.docx"`);
    res.sendFile(absPath);
  } catch (error) {
    console.error('Download report error:', error);
    res.status(500).json({ error: 'Failed to download report' });
  }
});

module.exports = router;
