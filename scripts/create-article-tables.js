const db = require('../config/dbAdapter');

async function createArticleTables() {
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
    
    // Check if articles table exists
    const articleTableExists = tables.some(row => row.table_name === 'articles');
    
    if (!articleTableExists) {
      console.log('🏗️ Creating articles table...');
      await db.execute(`
        CREATE TABLE IF NOT EXISTS articles (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id UUID,
          article_number VARCHAR(100) NOT NULL,
          article_name VARCHAR(255) NOT NULL,
          material_type VARCHAR(100),
          color VARCHAR(50),
          description TEXT,
          specifications JSONB,
          status VARCHAR(30) DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (client_id) REFERENCES clients(id),
          UNIQUE(client_id, article_number)
        );
      `);
      
      await db.execute(`
        CREATE TRIGGER update_articles_updated_at 
        BEFORE UPDATE ON articles
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      `);
      
      console.log('✅ Articles table created');
    } else {
      console.log('✅ Articles table already exists');
      await db.execute(`
        ALTER TABLE articles
        ALTER COLUMN client_id DROP NOT NULL;
      `);
      console.log('✅ Ensured articles.client_id is optional');
    }
    
    // Check if test_batches table exists
    const batchTableExists = tables.some(row => row.table_name === 'test_batches');
    
    if (!batchTableExists) {
      console.log('🏗️ Creating test_batches table...');
      await db.execute(`
        CREATE TABLE IF NOT EXISTS test_batches (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          article_id UUID NOT NULL,
          batch_number VARCHAR(100) NOT NULL,
          batch_date DATE DEFAULT CURRENT_DATE,
          notes TEXT,
          status VARCHAR(30) DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
          UNIQUE(article_id, batch_number)
        );
      `);
      
      await db.execute(`
        CREATE TRIGGER update_test_batches_updated_at 
        BEFORE UPDATE ON test_batches
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      `);
      
      console.log('✅ Test batches table created');
    } else {
      console.log('✅ Test batches table already exists');
    }
    
    // Check if article_tests table exists
    const articleTestsExists = tables.some(row => row.table_name === 'article_tests');
    
    if (!articleTestsExists) {
      console.log('🏗️ Creating article_tests table...');
      await db.execute(`
        CREATE TABLE IF NOT EXISTS article_tests (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          article_id UUID NOT NULL,
          batch_id UUID,
          test_name VARCHAR(255) NOT NULL,
          test_standard VARCHAR(100),
          client_requirement TEXT,
          category VARCHAR(50),
          execution_type VARCHAR(20),
          inhouse_test_id VARCHAR(50),
          vendor_name VARCHAR(255),
          vendor_contact VARCHAR(255),
          vendor_email VARCHAR(255),
          expected_report_date DATE,
          outsourced_report_url TEXT,
          assigned_tester_id INTEGER,
          test_deadline DATE,
          assigned_at TIMESTAMP,
          assigned_by INTEGER,
          status VARCHAR(30) DEFAULT 'pending',
          result VARCHAR(10),
          result_data JSONB,
          submitted_at TIMESTAMP NULL,
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
          FOREIGN KEY (batch_id) REFERENCES test_batches(id) ON DELETE SET NULL,
          FOREIGN KEY (assigned_tester_id) REFERENCES users(id),
          FOREIGN KEY (assigned_by) REFERENCES users(id)
        );
      `);
      
      await db.execute(`
        CREATE TRIGGER update_article_tests_updated_at 
        BEFORE UPDATE ON article_tests
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      `);
      
      console.log('✅ Article tests table created');
    } else {
      console.log('✅ Article tests table already exists');
    }
    
    console.log('🎉 Article tables setup complete!');
    
  } catch (error) {
    console.error('❌ Failed to create article tables:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  createArticleTables();
}

module.exports = { createArticleTables };
