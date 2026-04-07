const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false
  }
});

async function checkTestAssignments() {
  try {
    console.log('Checking test assignments...\n');
    
    // Check assigned tests by tester
    const assignedTests = await pool.query(`
      SELECT assigned_tester_id, COUNT(*) as count 
      FROM article_tests 
      WHERE assigned_tester_id IS NOT NULL 
      GROUP BY assigned_tester_id
    `);
    
    console.log('Tests assigned by tester:');
    assignedTests.rows.forEach(row => {
      console.log(`  Tester ${row.assigned_tester_id}: ${row.count} tests`);
    });
    
    // Check sample in-house tests
    const sampleTests = await pool.query(`
      SELECT id, test_name, assigned_tester_id, status, execution_type
      FROM article_tests 
      WHERE execution_type = 'inhouse' 
      LIMIT 5
    `);
    
    console.log('\nSample in-house tests:');
    sampleTests.rows.forEach(test => {
      console.log(`  ${test.id}: ${test.test_name} (assigned to: ${test.assigned_tester_id || 'none'}, status: ${test.status})`);
    });
    
    // Assign a test to tester 2 for testing
    console.log('\nAssigning a test to tester 2 for testing...');
    const unassignedTest = await pool.query(`
      SELECT id, test_name 
      FROM article_tests 
      WHERE execution_type = 'inhouse' 
      AND assigned_tester_id IS NULL 
      LIMIT 1
    `);
    
    if (unassignedTest.rows.length > 0) {
      const testId = unassignedTest.rows[0].id;
      const testName = unassignedTest.rows[0].test_name;
      
      await pool.query(`
        UPDATE article_tests SET 
          assigned_tester_id = $1,
          status = 'assigned',
          assigned_at = NOW(),
          assigned_by = 1
        WHERE id = $2
      `, [2, testId]);
      
      console.log(`✅ Assigned test "${testName}" (ID: ${testId}) to tester 2`);
    } else {
      console.log('No unassigned in-house tests found');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkTestAssignments();
