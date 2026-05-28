/**
 * One-off: populate SATRA-TM-31 test library metadata (input_parameters, steps, pass/fail).
 * Run: node scripts/patch-satra-tm-31.js
 */
require('dotenv').config();
const dbAdapter = require('../config/dbAdapter');

const metadata = {
  input_parameters: {
    dry_stages: {
      type: 'object',
      default: null,
      notes: 'Per-cycle dry abrasion checkpoints (1600–25600 cycles). Mark stages required per client spec.'
    },
    wet_stages: {
      type: 'object',
      default: null,
      notes: 'Per-cycle wet abrasion checkpoints. Mark stages required per client spec.'
    }
  },
  calculation_steps: [
    {
      step: 1,
      formula: 'required_dry_stages → all status OK',
      description: 'Evaluate each client-required dry cycle stage.'
    },
    {
      step: 2,
      formula: 'required_wet_stages → all status OK',
      description: 'Evaluate each client-required wet cycle stage.'
    },
    {
      step: 3,
      formula: 'PASS if dry_passes AND wet_passes',
      description: 'Overall pass only when all required stages pass.'
    }
  ],
  pass_fail_logic: {
    pass_condition: 'All client-required dry and wet cycle stages show status OK.',
    fail_condition: 'Any required stage shows FAIL, or no required stages are selected.',
    notes: 'Required cycle counts are set per order/client specification.'
  }
};

async function main() {
  await dbAdapter.testConnection();
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
      'SATRA-TM-31'
    ]
  );
  console.log('SATRA-TM-31 updated, rows:', result.rowCount);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
