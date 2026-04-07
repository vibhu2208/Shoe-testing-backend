const fs = require('fs');
const path = require('path');
const db = require('../config/dbAdapter');

async function initializeDatabase() {
  
  try {
    console.log('🔄 Testing database connection...');
    await db.testConnection();
    
    console.log('📋 Reading schema file...');
    const schemaPath = path.join(__dirname, '../config/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('🏗️ Creating database tables...');
    await db.execute(schema);

    const periodicPath = path.join(__dirname, '../config/periodic_testing.sql');
    if (fs.existsSync(periodicPath)) {
      console.log('📋 Applying periodic testing DDL...');
      const periodicSql = fs.readFileSync(periodicPath, 'utf8');
      await db.execute(periodicSql);
    }
    
    console.log('✅ Database initialized successfully!');
    console.log('📊 Tables created:');
    
    // List all tables
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    tables.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  initializeDatabase();
}

module.exports = { initializeDatabase };
