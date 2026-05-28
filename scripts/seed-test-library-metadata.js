/**
 * Populate input_parameters, calculation_steps, and pass_fail_logic for all tests.
 * Run: node scripts/seed-test-library-metadata.js
 */
require('dotenv').config();
const dbAdapter = require('../config/dbAdapter');
const { TEST_LIBRARY_METADATA } = require('../data/testLibraryMetadata');

async function main() {
  await dbAdapter.testConnection();

  for (const [id, metadata] of Object.entries(TEST_LIBRARY_METADATA)) {
    const result = await dbAdapter.execute(
      `UPDATE tests SET
        input_parameters = $1,
        calculation_steps = $2,
        pass_fail_logic = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4`,
      [
        JSON.stringify(metadata.input_parameters),
        JSON.stringify(metadata.calculation_steps),
        JSON.stringify(metadata.pass_fail_logic),
        id
      ]
    );
    console.log(`${id}: updated ${result.rowCount} row(s)`);
  }

  console.log('Done — all test library metadata seeded.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
