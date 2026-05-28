const db = require('../config/dbAdapter');

async function makeDocumentClientOptional() {
  try {
    console.log('Making client_documents.client_id optional...');
    await db.testConnection();

    await db.execute(`
      ALTER TABLE client_documents
      ALTER COLUMN client_id DROP NOT NULL;
    `);

    console.log('client_documents.client_id is now nullable');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  makeDocumentClientOptional();
}

module.exports = { makeDocumentClientOptional };
