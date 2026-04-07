const dbAdapter = require('../config/dbAdapter');

/**
 * Migration script to convert order-wise data to article-wise structure
 * This script will:
 * 1. Create articles from existing test_orders
 * 2. Create initial test batches for each article
 * 3. Migrate order_tests to article_tests
 * 4. Preserve all existing data relationships
 */

async function migrateToArticles() {
  console.log('🚀 Starting migration from order-wise to article-wise structure...');
  
  try {
    await dbAdapter.transaction(async (client) => {
      // Step 1: Get all existing test orders
      console.log('📋 Fetching existing test orders...');
      const orders = await client.query(`
        SELECT 
          o.*,
          c.company_name,
          COUNT(ot.id) as test_count
        FROM test_orders o
        LEFT JOIN clients c ON o.client_id = c.id
        LEFT JOIN order_tests ot ON o.id = ot.order_id
        GROUP BY o.id, c.company_name
        ORDER BY o.created_at
      `);
      
      console.log(`📊 Found ${orders.rows.length} orders to migrate`);
      
      // Step 2: Create articles from orders
      const articleMap = new Map(); // order_id -> article_id
      
      for (const order of orders.rows) {
        // Generate article info from order
        const articleNumber = order.article_number || `ART-${order.order_number}`;
        const articleName = order.product_name || `Article ${articleNumber}`;
        
        console.log(`📦 Creating article: ${articleNumber} for client ${order.client_id}`);
        
        // Check if article already exists for this client
        const existingArticle = await client.query(`
          SELECT id FROM articles 
          WHERE client_id = $1 AND article_number = $2
        `, [order.client_id, articleNumber]);
        
        let articleId;
        
        if (existingArticle.rows.length > 0) {
          articleId = existingArticle.rows[0].id;
          console.log(`   ♻️  Using existing article: ${articleId}`);
        } else {
          // Create new article
          const articleResult = await client.query(`
            INSERT INTO articles (
              client_id, article_number, article_name, material_type, 
              color, description, status, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
          `, [
            order.client_id,
            articleNumber,
            articleName,
            order.material_type,
            order.color,
            `Migrated from order ${order.order_number}`,
            order.status === 'draft' ? 'active' : order.status,
            order.created_at,
            order.updated_at
          ]);
          
          articleId = articleResult.rows[0].id;
          console.log(`   ✅ Created new article: ${articleId}`);
        }
        
        articleMap.set(order.id, articleId);
        
        // Step 3: Create test batch for this order
        const batchNumber = `BATCH-${order.order_number}`;
        console.log(`   📋 Creating test batch: ${batchNumber}`);
        
        const batchResult = await client.query(`
          INSERT INTO test_batches (
            article_id, batch_number, batch_date, notes, 
            status, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `, [
          articleId,
          batchNumber,
          order.created_at.toISOString().split('T')[0], // Extract date
          `Migrated from order ${order.order_number}`,
          'active',
          order.created_at,
          order.updated_at
        ]);
        
        const batchId = batchResult.rows[0].id;
        console.log(`   ✅ Created batch: ${batchId}`);
        
        // Step 4: Migrate order tests to article tests
        const orderTests = await client.query(`
          SELECT * FROM order_tests WHERE order_id = $1
        `, [order.id]);
        
        console.log(`   🧪 Migrating ${orderTests.rows.length} tests...`);
        
        for (const test of orderTests.rows) {
          await client.query(`
            INSERT INTO article_tests (
              article_id, batch_id, test_name, test_standard, client_requirement,
              category, execution_type, inhouse_test_id, vendor_name, vendor_contact,
              vendor_email, expected_report_date, outsourced_report_url,
              assigned_tester_id, test_deadline, assigned_at, assigned_by,
              status, result, result_data, submitted_at, notes,
              created_at, updated_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
            )
          `, [
            articleId, batchId, test.test_name, test.test_standard, test.client_requirement,
            test.category, test.execution_type, test.inhouse_test_id, test.vendor_name, test.vendor_contact,
            test.vendor_email, test.expected_report_date, test.outsourced_report_url,
            test.assigned_tester_id, test.test_deadline, test.assigned_at, test.assigned_by,
            test.status, test.result, test.result_data, test.submitted_at, test.notes,
            test.created_at, test.updated_at
          ]);
        }
        
        console.log(`   ✅ Migrated ${orderTests.rows.length} tests for order ${order.order_number}`);
      }
      
      // Step 5: Update reports to reference articles (if needed)
      console.log('📊 Updating reports to reference articles...');
      const reports = await client.query(`
        SELECT r.*, o.id as order_id 
        FROM reports r
        JOIN test_orders o ON r.order_id = o.id
      `);
      
      for (const report of reports.rows) {
        const articleId = articleMap.get(report.order_id);
        if (articleId) {
          // Add article_id column to reports if it doesn't exist
          await client.query(`
            ALTER TABLE reports ADD COLUMN IF NOT EXISTS article_id UUID
          `);
          
          await client.query(`
            UPDATE reports SET article_id = $1 WHERE id = $2
          `, [articleId, report.id]);
        }
      }
      
      console.log('✅ Migration completed successfully!');
      
      // Step 6: Generate migration summary
      const summary = await generateMigrationSummary(client);
      console.log('\n📈 Migration Summary:');
      console.log(summary);
      
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

async function generateMigrationSummary(client) {
  const articlesCount = await client.query('SELECT COUNT(*) as count FROM articles');
  const batchesCount = await client.query('SELECT COUNT(*) as count FROM test_batches');
  const articleTestsCount = await client.query('SELECT COUNT(*) as count FROM article_tests');
  const ordersCount = await client.query('SELECT COUNT(*) as count FROM test_orders');
  const orderTestsCount = await client.query('SELECT COUNT(*) as count FROM order_tests');
  
  return `
📊 Articles created: ${articlesCount.rows[0].count}
📋 Test batches created: ${batchesCount.rows[0].count}
🧪 Article tests migrated: ${articleTestsCount.rows[0].count}
📦 Original orders: ${ordersCount.rows[0].count}
🔬 Original order tests: ${orderTestsCount.rows[0].count}

✅ All data has been successfully migrated to the article-wise structure!
⚠️  Original order tables are preserved for backward compatibility.
`;
}

// Rollback function (in case migration needs to be reversed)
async function rollbackMigration() {
  console.log('🔄 Rolling back migration...');
  
  try {
    await dbAdapter.transaction(async (client) => {
      // Clear migrated data
      await client.query('DELETE FROM article_tests');
      await client.query('DELETE FROM test_batches');
      await client.query('DELETE FROM articles');
      
      // Remove article_id column from reports if it exists
      await client.query(`
        ALTER TABLE reports DROP COLUMN IF EXISTS article_id
      `);
      
      console.log('✅ Migration rolled back successfully!');
    });
  } catch (error) {
    console.error('❌ Rollback failed:', error);
    throw error;
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'migrate') {
    migrateToArticles()
      .then(() => {
        console.log('🎉 Migration completed successfully!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('💥 Migration failed:', error);
        process.exit(1);
      });
  } else if (command === 'rollback') {
    rollbackMigration()
      .then(() => {
        console.log('🔄 Rollback completed successfully!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('💥 Rollback failed:', error);
        process.exit(1);
      });
  } else {
    console.log(`
Usage:
  node migrate-to-articles.js migrate   - Run the migration
  node migrate-to-articles.js rollback  - Rollback the migration
    `);
    process.exit(1);
  }
}

module.exports = {
  migrateToArticles,
  rollbackMigration
};
