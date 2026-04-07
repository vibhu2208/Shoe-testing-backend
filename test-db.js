const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
  ssl: {
    rejectUnauthorized: false
  }
});

async function testQueries() {
  try {
    console.log('Testing database queries...\n');
    
    // Test 1: Simple query without parameters
    console.log('1. Testing simple query...');
    const result1 = await pool.query('SELECT COUNT(*) as count FROM users');
    console.log('✅ Total users:', result1.rows[0].count);
    
    // Test 2: Query with parameters
    console.log('\n2. Testing parameterized query...');
    const result2 = await pool.query('SELECT id, name, role, department FROM users WHERE role = $1', ['tester']);
    console.log('✅ Testers found:', result2.rows.length);
    result2.rows.forEach(user => console.log(`  - ${user.name} (${user.department})`));
    
    // Test 3: Test the exact query from the API
    console.log('\n3. Testing API query...');
    const result3 = await pool.query('SELECT id, name, department FROM users WHERE role = $1 ORDER BY name', ['tester']);
    console.log('✅ API query result:', result3.rows.length, 'testers');
    
    console.log('\n🎉 All database tests passed!');
    
  } catch (error) {
    console.error('❌ Database test failed:', error.message);
    console.error('Error details:', {
      code: error.code,
      position: error.position,
      severity: error.severity
    });
  } finally {
    await pool.end();
  }
}

testQueries();
