require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const dbAdapter = require('../config/dbAdapter');

dbAdapter
  .query(
    `SELECT id, test_name, client_requirement, result_data
     FROM article_tests
     WHERE inhouse_test_id = 'SATRA-TM-31'
     ORDER BY submitted_at DESC NULLS LAST
     LIMIT 2`
  )
  .then((rows) => {
    for (const t of rows) {
      const rd = t.result_data || {};
      console.log('---', t.id, t.test_name);
      console.log('client_requirement:', t.client_requirement?.slice(0, 120));
      console.log('calculated_results:', JSON.stringify(rd.calculated_results, null, 2));
      console.log('dry_stages keys:', rd.dry_stages ? Object.keys(rd.dry_stages) : 'none in root');
      console.log('wet_stages keys:', rd.wet_stages ? Object.keys(rd.wet_stages) : 'none in root');
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
