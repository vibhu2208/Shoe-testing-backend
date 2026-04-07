const express = require('express');
const dbAdapter = require('../config/dbAdapter');
const multer = require('multer');
const XLSX = require('xlsx');
const router = express.Router();
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

// Get users/testers - this route must come before /:id route
router.get('/users', async (req, res) => {
  try {
    const { role, is_active } = req.query;
    
    // Use direct pool connection to avoid adapter issues
    const { pool } = require('../config/database');
    
    let query = 'SELECT id, name, department, role, is_active FROM users WHERE 1=1';
    const params = [];
    
    if (role) {
      params.push(role);
      query += ' AND role = $' + params.length;
    }
    
    if (is_active !== undefined) {
      params.push(is_active === 'true');
      query += ' AND is_active = $' + params.length;
    }
    
    query += ' ORDER BY name';
    
    console.log('Executing query:', query, 'with params:', params);
    
    const client = await pool.connect();
    try {
      const result = await client.query(query, params);
      console.log('Query successful, found', result.rows.length, 'users');
      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/bulk-template', (req, res) => {
  const headers = [
    'companyName',
    'clientCode',
    'industry',
    'country',
    'address',
    'status',
    'primaryContactName',
    'primaryContactDesignation',
    'primaryContactEmail',
    'primaryContactPhone',
    'secondaryContactName',
    'secondaryContactDesignation',
    'secondaryContactEmail',
    'secondaryContactPhone'
  ];

  const example = [{
    companyName: 'Acme Footwear Pvt Ltd',
    clientCode: 'ACME-001',
    industry: 'Footwear',
    country: 'India',
    address: 'Bangalore, Karnataka',
    status: 'active',
    primaryContactName: 'Riya Sharma',
    primaryContactDesignation: 'QA Manager',
    primaryContactEmail: 'riya.sharma@acme.com',
    primaryContactPhone: '+91-9000000000',
    secondaryContactName: 'Amit Verma',
    secondaryContactDesignation: 'Sourcing Lead',
    secondaryContactEmail: 'amit.verma@acme.com',
    secondaryContactPhone: '+91-9111111111'
  }];

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(example, { header: headers });
  XLSX.utils.book_append_sheet(workbook, sheet, 'clients');
  const fileBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="clients_bulk_template.xlsx"');
  res.send(fileBuffer);
});

router.post('/bulk-upload', upload.single('file'), async (req, res) => {
  try {
    const rows = parseBulkRowsFromBuffer(req.file);
    if (!rows.length) {
      return res.status(400).json({ error: 'No rows found in uploaded file' });
    }

    const parsedRows = rows.map((row, index) => {
      const companyName = normalizeCell(row.companyName);
      const primaryContactName = normalizeCell(row.primaryContactName);
      const primaryContactEmail = normalizeCell(row.primaryContactEmail);

      if (!companyName) {
        throw new Error(`Row ${index + 2}: companyName is required`);
      }
      if (!primaryContactName) {
        throw new Error(`Row ${index + 2}: primaryContactName is required`);
      }
      if (!primaryContactEmail) {
        throw new Error(`Row ${index + 2}: primaryContactEmail is required`);
      }

      return {
        companyName,
        clientCode: normalizeCell(row.clientCode) || `VRL-${String(Date.now() + index).slice(-6)}`,
        industry: normalizeCell(row.industry),
        country: normalizeCell(row.country),
        address: normalizeCell(row.address),
        status: normalizeCell(row.status).toLowerCase() === 'inactive' ? 'inactive' : 'active',
        primaryContact: {
          name: primaryContactName,
          designation: normalizeCell(row.primaryContactDesignation),
          email: primaryContactEmail,
          phone: normalizeCell(row.primaryContactPhone)
        },
        secondaryContact: {
          name: normalizeCell(row.secondaryContactName),
          designation: normalizeCell(row.secondaryContactDesignation),
          email: normalizeCell(row.secondaryContactEmail),
          phone: normalizeCell(row.secondaryContactPhone)
        }
      };
    });

    const createdClientIds = await dbAdapter.transaction(async (client) => {
      const createdIds = [];

      for (const row of parsedRows) {
        const clientResult = await client.query(`
          INSERT INTO clients (company_name, client_code, industry, country, address, status)
          VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        `, [row.companyName, row.clientCode, row.industry, row.country, row.address, row.status]);

        const clientId = clientResult.rows[0].id;
        createdIds.push(clientId);

        await client.query(`
          INSERT INTO client_contacts (client_id, name, designation, email, phone, is_primary)
          VALUES ($1, $2, $3, $4, $5, true)
        `, [clientId, row.primaryContact.name, row.primaryContact.designation, row.primaryContact.email, row.primaryContact.phone]);

        if (row.secondaryContact.name || row.secondaryContact.email) {
          await client.query(`
            INSERT INTO client_contacts (client_id, name, designation, email, phone, is_primary)
            VALUES ($1, $2, $3, $4, $5, false)
          `, [clientId, row.secondaryContact.name, row.secondaryContact.designation, row.secondaryContact.email, row.secondaryContact.phone]);
        }
      }

      return createdIds;
    });

    res.status(201).json({
      message: 'Clients uploaded successfully',
      createdCount: createdClientIds.length,
      clientIds: createdClientIds
    });
  } catch (error) {
    console.error('Error bulk uploading clients:', error);
    res.status(400).json({ error: error.message || 'Failed to bulk upload clients' });
  }
});

// Get all clients
router.get('/', async (req, res) => {
  try {
    const clients = await dbAdapter.query('SELECT * FROM clients ORDER BY company_name');
    
    // Build the full client data
    const fullClients = [];
    for (let client of clients) {
      // Get primary contact
      const contact = await dbAdapter.query(
        'SELECT name, email FROM client_contacts WHERE client_id = $1 AND is_primary = true',
        [client.id]
      );
      
      // Get article count
      const articleCount = await dbAdapter.query(
        'SELECT COUNT(*) as count FROM articles WHERE client_id = $1',
        [client.id]
      );
      
      // Get test count
      const testCount = await dbAdapter.query(
        'SELECT COUNT(*) as count FROM article_tests WHERE article_id IN (SELECT id FROM articles WHERE client_id = $1)',
        [client.id]
      );
      
      const fullClient = {
        ...client,
        primary_contact_name: contact[0]?.name || null,
        primary_contact_email: contact[0]?.email || null,
        total_orders: articleCount[0]?.count || 0,
        total_tests: testCount[0]?.count || 0,
        total_reports: 0
      };
      
      fullClients.push(fullClient);
    }
    
    res.json(fullClients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// GET /api/clients/stats - Dashboard statistics for admin/client view
// Note: This route must be declared before "/:id" routes.
router.get('/stats', async (req, res) => {
  try {
    const completedStatuses = ['submitted', 'pass', 'fail'];

    const totalArticlesRes = await dbAdapter.query(
      'SELECT COUNT(*) as count FROM articles'
    );
    const totalArticles = Number(totalArticlesRes[0]?.count || 0);

    const totalTestsRes = await dbAdapter.query(
      'SELECT COUNT(*) as count FROM article_tests'
    );
    const totalTests = Number(totalTestsRes[0]?.count || 0);

    const completedTestsRes = await dbAdapter.query(
      `SELECT COUNT(*) as count
       FROM article_tests
       WHERE status IN ('submitted', 'pass', 'fail')`
    );
    const completedTests = Number(completedTestsRes[0]?.count || 0);

    const pendingTestsRes = await dbAdapter.query(
      `SELECT COUNT(*) as count
       FROM article_tests
       WHERE status NOT IN ('submitted', 'pass', 'fail')`
    );
    const pendingTests = Number(pendingTestsRes[0]?.count || 0);

    const statusCountsRes = await dbAdapter.query(
      `SELECT status, COUNT(*) as count
       FROM article_tests
       GROUP BY status
       ORDER BY count DESC`
    );

    const statusCounts = statusCountsRes.reduce((acc, row) => {
      acc[row.status] = Number(row.count || 0);
      return acc;
    }, {});

    const reportsSentRes = await dbAdapter.query(
      'SELECT COUNT(*) as count FROM reports WHERE sent_to_client = true'
    );
    const reportsSent = Number(reportsSentRes[0]?.count || 0);

    // Validation: pending + completed should equal total tests (if all statuses are covered).
    if (pendingTests + completedTests !== totalTests) {
      console.warn('[clients/stats] pending+completed mismatch', {
        pendingTests,
        completedTests,
        totalTests,
      });
    }

    const payload = {
      totalArticles,
      pendingTests,
      completedTests,
      reportsSent,
      statusCounts,
    };

    console.log('[clients/stats] computed dashboard payload', payload);
    res.json(payload);
  } catch (error) {
    console.error('[clients/stats] Error computing stats:', error);
    res.status(500).json({ error: 'Failed to compute dashboard stats' });
  }
});

// Get single client by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const clients = await dbAdapter.query('SELECT * FROM clients WHERE id = $1', [id]);
    
    if (clients.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    // Get contacts
    const contacts = await dbAdapter.query(
      'SELECT * FROM client_contacts WHERE client_id = $1 ORDER BY is_primary DESC',
      [id]
    );
    
    // Get articles
    const articles = await dbAdapter.query(
      'SELECT * FROM articles WHERE client_id = $1 ORDER BY created_at DESC',
      [id]
    );
    
    const client = {
      ...clients[0],
      contacts,
      articles
    };
    
    res.json(client);
  } catch (error) {
    console.error('Error fetching client:', error);
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});

// Create new client
router.post('/', async (req, res) => {
  try {
    const {
      companyName,
      clientCode,
      industry,
      country,
      address,
      status,
      primaryContact,
      secondaryContacts,
      extractedTests
    } = req.body;
    
    // Use PostgreSQL transaction
    const result = await dbAdapter.transaction(async (client) => {
      // Insert client
      const clientResult = await client.query(`
        INSERT INTO clients (company_name, client_code, industry, country, address, status)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
      `, [companyName, clientCode, industry, country, address, status]);
      
      const clientId = clientResult.rows[0].id;
      
      // Insert primary contact
      if (primaryContact) {
        await client.query(`
          INSERT INTO client_contacts (client_id, name, designation, email, phone, is_primary)
          VALUES ($1, $2, $3, $4, $5, true)
        `, [clientId, primaryContact.name, primaryContact.designation, primaryContact.email, primaryContact.phone]);
      }
      
      // Insert secondary contacts
      if (secondaryContacts && secondaryContacts.length > 0) {
        for (const contact of secondaryContacts) {
          await client.query(`
            INSERT INTO client_contacts (client_id, name, designation, email, phone, is_primary)
            VALUES ($1, $2, $3, $4, $5, false)
          `, [clientId, contact.name, contact.designation, contact.email, contact.phone]);
        }
      }
      
      return clientId;
    });
    
    res.status(201).json({
      message: 'Client created successfully',
      clientId: result
    });

  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

// Update client
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      companyName,
      clientCode,
      industry,
      country,
      address,
      status
    } = req.body;
    
    await dbAdapter.execute(`
      UPDATE clients SET 
        company_name = $1,
        client_code = $2,
        industry = $3,
        country = $4,
        address = $5,
        status = $6,
        updated_at = NOW()
      WHERE id = $7
    `, [companyName, clientCode, industry, country, address, status, id]);
    
    res.json({ message: 'Client updated successfully' });
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

// Delete client
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await dbAdapter.execute('DELETE FROM clients WHERE id = $1', [id]);
    
    res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

// Assign tester to a specific test
router.post('/article-tests/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const { tester_id, deadline, notes } = req.body;
    
    // Update the article_tests row
    await dbAdapter.execute(`
      UPDATE article_tests SET 
        assigned_tester_id = $1,
        test_deadline = $2,
        assigned_at = NOW(),
        assigned_by = 1,
        status = CASE 
          WHEN $1 IS NOT NULL THEN 'assigned'
          ELSE 'pending'
        END,
        notes = $3,
        updated_at = NOW()
      WHERE id = $4
    `, [tester_id || null, deadline || null, notes || null, id]);
    
    res.json({ message: 'Test assigned successfully' });
  } catch (error) {
    console.error('Error assigning test:', error);
    res.status(500).json({ error: 'Failed to assign test' });
  }
});

// Bulk assign tester to multiple tests
router.post('/article-tests/bulk-assign', async (req, res) => {
  try {
    const { article_test_ids, tester_id, deadline, notes } = req.body;
    
    if (!article_test_ids || article_test_ids.length === 0) {
      return res.status(400).json({ error: 'No test IDs provided' });
    }
    
    // Create placeholders for the IN clause
    const placeholders = article_test_ids.map((_, index) => `$${index + 5}`).join(',');
    
    // Update multiple article_tests rows
    await dbAdapter.execute(`
      UPDATE article_tests SET 
        assigned_tester_id = $1,
        test_deadline = $2,
        assigned_at = NOW(),
        assigned_by = 1,
        status = CASE 
          WHEN $1 IS NOT NULL THEN 'assigned'
          ELSE 'pending'
        END,
        notes = $3,
        updated_at = NOW()
      WHERE id IN (${placeholders})
      AND execution_type IN ('inhouse', 'both')
    `, [tester_id || null, deadline || null, notes || null, article_test_ids.length, ...article_test_ids]);
    
    res.json({ message: `${article_test_ids.length} tests assigned successfully` });
  } catch (error) {
    console.error('Error bulk assigning tests:', error);
    res.status(500).json({ error: 'Failed to bulk assign tests' });
  }
});

// Update article test
router.put('/article-tests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const testData = { ...req.body };

    // Align status with assignment when tests are edited directly.
    if (Object.prototype.hasOwnProperty.call(testData, 'assigned_tester_id')) {
      const hasTester = testData.assigned_tester_id !== null && testData.assigned_tester_id !== '';
      const existing = await dbAdapter.query('SELECT status FROM article_tests WHERE id = $1', [id]);
      const currentStatus = existing[0]?.status || 'pending';

      if (hasTester && ['pending', 'assigned'].includes(currentStatus) && !Object.prototype.hasOwnProperty.call(testData, 'status')) {
        testData.status = 'assigned';
      }

      if (!hasTester && currentStatus === 'assigned' && !Object.prototype.hasOwnProperty.call(testData, 'status')) {
        testData.status = 'pending';
      }
    }
    
    // Build the SET clause dynamically based on provided fields
    const updateFields = [];
    const values = [];
    let paramIndex = 1;
    
    const allowedFields = [
      'test_name', 'test_standard', 'client_requirement', 'category', 
      'execution_type', 'inhouse_test_id', 'vendor_name', 'vendor_contact', 
      'vendor_email', 'expected_report_date', 'assigned_tester_id', 
      'test_deadline', 'status', 'notes'
    ];
    
    allowedFields.forEach(field => {
      if (testData.hasOwnProperty(field)) {
        updateFields.push(`${field} = $${paramIndex}`);
        values.push(testData[field]);
        paramIndex++;
      }
    });
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    // Add updated_at
    updateFields.push(`updated_at = NOW()`);
    
    // Add the ID parameter
    values.push(id);
    
    const query = `
      UPDATE article_tests SET 
        ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
    `;
    
    await dbAdapter.execute(query, values);
    
    res.json({ message: 'Test updated successfully' });
  } catch (error) {
    console.error('Error updating test:', error);
    res.status(500).json({ error: 'Failed to update test' });
  }
});

module.exports = router;
