const dbAdapter = require('./config/dbAdapter');

async function updateUsers() {
  try {
    console.log('Updating existing users and adding testers...');
    
    // Update existing users to have department values
    await dbAdapter.execute("UPDATE users SET department = 'Administration' WHERE role = 'admin' AND department IS NULL");
    await dbAdapter.execute("UPDATE users SET department = 'General' WHERE role = 'tester' AND department IS NULL");
    
    // Insert tester users
    await dbAdapter.execute("INSERT INTO users (name, email, password, role, department, is_active) VALUES ('Rahul Sharma', 'rahul@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Mechanical Testing', true) ON CONFLICT (email) DO NOTHING");
    await dbAdapter.execute("INSERT INTO users (name, email, password, role, department, is_active) VALUES ('Priya Singh', 'priya@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Chemical Testing', true) ON CONFLICT (email) DO NOTHING");
    await dbAdapter.execute("INSERT INTO users (name, email, password, role, department, is_active) VALUES ('Amit Verma', 'amit@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Physical Testing', true) ON CONFLICT (email) DO NOTHING");
    await dbAdapter.execute("INSERT INTO users (name, email, password, role, department, is_active) VALUES ('Neha Gupta', 'neha@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Quality Assurance', true) ON CONFLICT (email) DO NOTHING");
    
    console.log('✅ Users updated successfully!');
    
    // Check the updated users
    const users = await dbAdapter.query('SELECT id, name, email, role, department, is_active FROM users ORDER BY id');
    console.log('\nUpdated users:');
    users.forEach(user => console.log(`  - ${user.id}: ${user.name} (${user.email}) - ${user.role} - ${user.department || 'No dept'} - Active: ${user.is_active}`));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Update failed:', error);
    process.exit(1);
  }
}

updateUsers();
