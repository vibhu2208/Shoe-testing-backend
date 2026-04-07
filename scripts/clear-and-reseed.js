const dbAdapter = require('../config/dbAdapter');
const { seedDatabase } = require('./seed');

async function clearAndReseed() {
  try {
    console.log('Clearing existing test data...');
    
    // Clear existing test data
    await dbAdapter.execute('DELETE FROM test_calculations');
    await dbAdapter.execute('DELETE FROM tests');
    
    console.log('Test data cleared successfully');
    
    // Reseed with complete test data
    console.log('Reseeding with complete test data...');
    await seedDatabase();
    
    console.log('Database reseeded successfully with all 9 tests!');
    
  } catch (error) {
    console.error('Error during clear and reseed:', error);
    process.exit(1);
  }
}

clearAndReseed();
