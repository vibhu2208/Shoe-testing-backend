const express = require('express');
const router = express.Router();
const dbAdapter = require('../config/dbAdapter');

// Get all clients
router.get('/', async (req, res) => {
  try {
    // Get basic clients
    const clients = await dbAdapter.query(`
      SELECT * FROM clients ORDER BY created_at DESC
    `);
    
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

// Get users (testers) for assignment
router.get('/users', async (req, res) => {
  try {
    const { role, is_active } = req.query;
    
    let query = 'SELECT id, name, email, role, department, is_active FROM users';
    const params = [];
    const conditions = [];
    
    if (role) {
      conditions.push(`role = $${params.length + 1}`);
      params.push(role);
    }
    
    if (is_active !== undefined) {
      conditions.push(`is_active = $${params.length + 1}`);
      params.push(is_active === 'true');
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY name';
    
    const users = await dbAdapter.query(query, params);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get client by ID with full details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get client details
    const clients = await dbAdapter.query(
      'SELECT * FROM clients WHERE id = $1',
      [id]
    );
    
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
      await client.query(`
        INSERT INTO client_contacts (client_id, name, designation, email, phone, is_primary)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [clientId, primaryContact.name, primaryContact.designation, primaryContact.email, primaryContact.phone, true]);
      
      // Insert secondary contacts
      for (const contact of secondaryContacts || []) {
        await client.query(`
          INSERT INTO client_contacts (client_id, name, designation, email, phone, is_primary)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [clientId, contact.name, contact.designation, contact.email, contact.phone, false]);
      }
      
      // Create initial test order if tests are provided
      if (extractedTests && extractedTests.length > 0) {
        const orderNumber = `ORD-${String(Date.now()).slice(-6)}`;
        
        const orderResult = await client.query(`
          INSERT INTO test_orders (client_id, order_number, status)
          VALUES ($1, $2, $3) RETURNING id
        `, [clientId, orderNumber, 'draft']);
        
        const orderId = orderResult.rows[0].id;
        
        // Insert extracted tests
        for (const test of extractedTests) {
          await client.query(`
            INSERT INTO order_tests (
              order_id, test_name, test_standard, client_requirement, category, 
              execution_type, inhouse_test_id, vendor_name, vendor_contact, 
              vendor_email, expected_report_date
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `, [
            orderId, test.testName, test.standard || '', test.clientRequirement,
            test.category, test.executionType, test.inhouseTestId,
            test.vendorName, test.vendorContact, test.vendorEmail,
            test.expectedReportDate
          ]);
        }
      }
      
      return clientId;
    });
    
    res.status(201).json({ 
      message: 'Client created successfully',
      clientCode
    });

  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

    
    console.log('📝 Creating new order for client:', clientId);
    console.log('📋 Order data:', { orderNumber, testsCount: tests?.length });
    
    // Generate order number if not provided
    const newOrderNumber = orderNumber || `ORD-${String(Date.now()).slice(-6)}`;
    
    const result = await dbAdapter.transaction(async (client) => {
      // Create new order
      const orderResult = await client.query(`
        INSERT INTO test_orders (client_id, order_number, status)
        VALUES ($1, $2, 'draft') RETURNING id, order_number, created_at
      `, [clientId, newOrderNumber]);
      
      const newOrder = orderResult.rows[0];
      console.log('✅ Order created:', newOrder);
      
      // Insert tests if provided
      if (tests && tests.length > 0) {
        for (const test of tests) {
          console.log('🧪 Inserting test:', test.testName);
          await client.query(`
            INSERT INTO order_tests (
              order_id, test_name, test_standard, client_requirement,
              category, execution_type, inhouse_test_id, vendor_name, vendor_contact,
              vendor_email, expected_report_date, assigned_tester_id, test_deadline, 
              assigned_at, assigned_by, notes, status
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
            )
          `, [
            newOrder.id,
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
            test.assignedTesterId || test.assigned_tester_id ? 1 : null, // Admin user ID
            test.notes || null,
            'pending'
          ]);
        }
        console.log('✅ All tests inserted successfully');
      }
      
      return newOrder;
    });
    
    res.status(201).json({
      message: 'Order created successfully',
      order: result
    });
  } catch (error) {
    console.error('❌ Error creating order for client:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Generate report for order
router.post('/:clientId/orders/:orderId/report', async (req, res) => {
  try {
    const { clientId, orderId } = req.params;
    
    await dbAdapter.transaction(async (client) => {
      // Create report record
      const reportNumber = `RPT-VRL-${String(Date.now()).slice(-6)}`;
      
      const reportResult = await client.query(`
        INSERT INTO reports (order_id, client_id, status)
        VALUES ($1, $2, 'draft') RETURNING id
      `, [orderId, clientId]);
      
      const reportId = reportResult.rows[0].id;
      
      // Get all completed tests for this order
      const tests = await client.query(`
        SELECT * FROM order_tests 
        WHERE order_id = $1 AND status IN ('submitted', 'pass', 'fail')
      `, [orderId]);
      
      // Create report items
      for (const test of tests.rows) {
        await client.query(`
          INSERT INTO report_items (report_id, order_test_id, test_name, result, include_in_report)
          VALUES ($1, $2, $3, $4, true)
        `, [reportId, test.id, test.test_name, test.result]);
      }
      
      return { reportId, reportNumber };
    });
    
    res.json({ 
      message: 'Report generated successfully',
      reportNumber
    });
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});


// Assign tester to a test
router.post('/order-tests/:testId/assign', async (req, res) => {
  try {
    const { testId } = req.params;
    const { tester_id, deadline, notes } = req.body;
    
    // For now, we'll use a hardcoded admin ID (1) for assigned_by
    // In a real app, this would come from the authenticated user
    const assigned_by = 1;
    
    await dbAdapter.execute(`
      UPDATE order_tests SET
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

// Bulk assign tests
router.post('/order-tests/bulk-assign', async (req, res) => {
  try {
    const { order_test_ids, tester_id, deadline, notes } = req.body;
    
    if (!order_test_ids || !Array.isArray(order_test_ids) || order_test_ids.length === 0) {
      return res.status(400).json({ error: 'order_test_ids array is required' });
    }
    
    // For now, we'll use a hardcoded admin ID (1) for assigned_by
    const assigned_by = 1;
    
    // Use transaction for bulk assignment
    await dbAdapter.transaction(async (client) => {
      for (const testId of order_test_ids) {
        await client.query(`
          UPDATE order_tests SET
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
      }
    });
    
    res.json({ message: `${order_test_ids.length} tests assigned successfully` });
  } catch (error) {
    console.error('Error bulk assigning tests:', error);
    res.status(500).json({ error: 'Failed to bulk assign tests' });
  }
});

module.exports = router;
