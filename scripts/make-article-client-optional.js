const db = require('../config/dbAdapter');

async function makeArticleClientOptional() {
  try {
    console.log('🔄 Making articles.client_id optional...');
    await db.testConnection();

    await db.execute(`
      ALTER TABLE articles
      ALTER COLUMN client_id DROP NOT NULL;
    `);

    console.log('✅ Updated: articles.client_id is now nullable');
    console.log('🎉 Migration complete');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  makeArticleClientOptional();
}

module.exports = { makeArticleClientOptional };
