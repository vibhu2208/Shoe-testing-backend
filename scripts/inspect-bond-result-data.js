require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const dbAdapter = require('../config/dbAdapter');

dbAdapter
  .query(
    `SELECT id, test_name, client_requirement, result_data
     FROM article_tests
     WHERE inhouse_test_id = 'SATRA-TM-281' AND status = 'submitted'
     ORDER BY submitted_at DESC NULLS LAST
     LIMIT 3`
  )
  .then((rows) => {
    for (const t of rows) {
      const rd = t.result_data || {};
      console.log('---', t.id);
      console.log('client_requirement (column):', t.client_requirement);
      console.log('result_data.client_requirement:', rd.client_requirement);
      console.log('client_spec_min_bond_strength:', rd.client_spec_min_bond_strength);
      console.log('calculated_results keys:', rd.calculated_results ? Object.keys(rd.calculated_results) : 'none');
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
