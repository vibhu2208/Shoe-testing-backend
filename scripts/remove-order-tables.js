const db = require('../config/dbAdapter');

async function removeOrderTables() {
  try {
    console.log('🔄 Testing database connection...');
    await db.testConnection();
    
    console.log('📊 Checking existing tables...');
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log('Existing tables:');
    tables.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    // Order-wise tables to remove
    const orderTables = [
      'test_orders',
      'order_tests'
    ];
    
    console.log('\n🗑️ Removing order-wise tables...');
    
    for (const tableName of orderTables) {
      const tableExists = tables.some(row => row.table_name === tableName);
      
      if (tableExists) {
        console.log(`   Removing ${tableName}...`);
        
        // Get row count before deletion
        const countResult = await db.query(`SELECT COUNT(*) as count FROM ${tableName}`);
        const rowCount = countResult[0].count;
        console.log(`   - Found ${rowCount} rows in ${tableName}`);
        
        // Drop the table
        await db.execute(`DROP TABLE ${tableName} CASCADE`);
        console.log(`   ✅ Dropped ${tableName}`);
      } else {
        console.log(`   ⚠️ Table ${tableName} does not exist`);
      }
    }
    
    console.log('\n📊 Verifying remaining tables...');
    const remainingTables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log('Remaining tables after cleanup:');
    remainingTables.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    console.log('\n🎉 Order-wise tables removal complete!');
    console.log('✅ System is now purely article-wise');
    
  } catch (error) {
    console.error('❌ Failed to remove order tables:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  removeOrderTables();
}

module.exports = { removeOrderTables };
