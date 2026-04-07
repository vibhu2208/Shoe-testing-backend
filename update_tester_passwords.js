const bcrypt = require('bcryptjs');
const dbAdapter = require('./config/dbAdapter');

async function updateTesterPasswords() {
  try {
    console.log('Creating password hash for "password"...');
    const passwordHash = await bcrypt.hash('password', 10);
    console.log('Hash generated:', passwordHash);
    
    console.log('Updating tester passwords...');
    
    // Update all tester accounts to use "password" as password
    await dbAdapter.execute(`
      UPDATE users 
      SET password = $1 
      WHERE role = 'tester'
    `, [passwordHash]);
    
    console.log('✅ All tester passwords updated to: "password"');
    
    // Verify the updated users
    const users = await dbAdapter.query('SELECT id, name, email, role, department FROM users WHERE role = $1 ORDER BY id', ['tester']);
    console.log('\nTester accounts with new passwords:');
    users.forEach(user => console.log('  - ' + user.name + ' (' + user.email + ') - ' + user.department));
    
    console.log('\n🔑 Login Credentials:');
    console.log('Email: rahul@virola.com | Password: password');
    console.log('Email: priya@virola.com | Password: password');
    console.log('Email: amit@virola.com | Password: password');
    console.log('Email: neha@virola.com | Password: password');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Update failed:', error);
    process.exit(1);
  }
}

updateTesterPasswords();
