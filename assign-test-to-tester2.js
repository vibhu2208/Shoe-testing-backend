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

async function assignTestToTester2() {
  try {
    console.log('Assigning a test to tester 2...\n');
    
    // Update one test to be assigned to tester 2
    const result = await pool.query(`
      UPDATE article_tests SET 
        assigned_tester_id = 2,
        status = 'assigned',
        assigned_at = NOW(),
        assigned_by = 1,
        test_deadline = '2026-03-25'
      WHERE assigned_tester_id = 7 
      AND execution_type = 'inhouse'
      RETURNING id, test_name
    `);
    
    if (result.rows.length > 0) {
      console.log(`✅ Reassigned test "${result.rows[0].test_name}" (ID: ${result.rows[0].id}) to tester 2`);
    }
    
    // Check how many tests are now assigned to tester 2
    const countResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM article_tests 
      WHERE assigned_tester_id = 2
    `);
    
    console.log(`Tests now assigned to tester 2: ${countResult.rows[0].count}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

assignTestToTester2();
