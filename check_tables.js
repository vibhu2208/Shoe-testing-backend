const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function checkTables() {
  const dbPath = path.join(__dirname, 'data/virola_lims.db');
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  try {
    console.log('=== ALL TABLES ===');
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    console.log(tables.map(t => t.name));

  } catch (error) {
    console.error('Database error:', error);
  } finally {
    await db.close();
  }
}

checkTables();
