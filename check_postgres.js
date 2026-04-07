const dbAdapter = require('./config/dbAdapter');

async function checkDatabase() {
  try {
    console.log('Checking PostgreSQL database schema...');
    
    // Check users table columns
    const usersColumns = await dbAdapter.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    
    console.log('Users table columns:');
    usersColumns.forEach(col => console.log(`  - ${col.column_name}: ${col.data_type}`));
    
    // Check order_tests table columns
    const orderTestsColumns = await dbAdapter.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'order_tests'
      ORDER BY ordinal_position
    `);
    
    console.log('\nOrder_tests table columns:');
    orderTestsColumns.forEach(col => console.log(`  - ${col.column_name}: ${col.data_type}`));
    
    // Check existing users
    const users = await dbAdapter.query('SELECT id, name, email, role, department, is_active FROM users ORDER BY id');
    console.log('\nExisting users:');
    users.forEach(user => console.log(`  - ${user.id}: ${user.name} (${user.email}) - ${user.role} - ${user.department || 'No dept'} - Active: ${user.is_active}`));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Check failed:', error);
    process.exit(1);
  }
}

checkDatabase();
