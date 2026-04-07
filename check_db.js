const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function checkDatabase() {
  const dbPath = path.join(__dirname, 'data/virola_lims.db');
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  try {
    console.log('=== CLIENTS TABLE ===');
    const clients = await db.all('SELECT * FROM clients');
    console.log(clients);

    console.log('\n=== CLIENT CONTACTS TABLE ===');
    const contacts = await db.all('SELECT * FROM client_contacts');
    console.log(contacts);

    console.log('\n=== TEST ORDERS TABLE ===');
    const orders = await db.all('SELECT * FROM test_orders');
    console.log(orders);

    console.log('\n=== ORDER TESTS TABLE ===');
    const orderTests = await db.all('SELECT * FROM order_tests LIMIT 5');
    console.log(orderTests);

  } catch (error) {
    console.error('Database error:', error);
  } finally {
    await db.close();
  }
}

checkDatabase();
