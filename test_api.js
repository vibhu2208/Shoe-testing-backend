const dbAdapter = require('./config/dbAdapter');

async function testAPI() {
  try {
    console.log('Testing users API query...');
    
    // Test the exact query that the API uses
    const users = await dbAdapter.query(
      'SELECT id, name, email, role, department, is_active FROM users WHERE role = $1 AND is_active = $2 ORDER BY name', 
      ['tester', true]
    );
    
    console.log('✅ API query successful!');
    console.log('Testers returned:');
    users.forEach(user => console.log(`  - ${user.id}: ${user.name} (${user.department})`));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ API query failed:', error);
    process.exit(1);
  }
}

testAPI();
