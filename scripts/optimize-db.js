const dbAdapter = require('../config/dbAdapter');

async function optimizeDatabase() {
  try {
    console.log('🚀 Optimizing database for scalability...');
    
    // Add performance indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_tests_category ON tests(category)',
      'CREATE INDEX IF NOT EXISTS idx_tests_standard ON tests(standard)', 
      'CREATE INDEX IF NOT EXISTS idx_tests_name ON tests(name)',
      'CREATE INDEX IF NOT EXISTS idx_test_calculations_test_id ON test_calculations(test_id)',
      'CREATE INDEX IF NOT EXISTS idx_test_calculations_user_id ON test_calculations(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_test_calculations_created_at ON test_calculations(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)'
    ];

    for (const indexSql of indexes) {
      try {
        await dbAdapter.execute(indexSql);
        console.log('✅ Created index:', indexSql);
      } catch (error) {
        console.log('⚠️ Index already exists or failed:', indexSql);
      }
    }

    // Analyze table statistics
    await dbAdapter.execute('ANALYZE tests');
    await dbAdapter.execute('ANALYZE test_calculations');
    await dbAdapter.execute('ANALYZE users');
    
    console.log('✅ Database optimization completed!');
    
  } catch (error) {
    console.error('❌ Database optimization failed:', error);
  }
}

optimizeDatabase();
