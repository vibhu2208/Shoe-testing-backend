require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const dbAdapter = require('../config/dbAdapter');

dbAdapter
  .query(
    `SELECT id, test_name, client_requirement, result_data
     FROM article_tests
     WHERE inhouse_test_id = 'SATRA-TM-92' AND status = 'submitted'
     ORDER BY submitted_at DESC NULLS LAST
     LIMIT 2`
  )
  .then((rows) => {
    for (const t of rows) {
      const rd = t.result_data || {};
      console.log('---', t.id);
      console.log('client_requirement:', t.client_requirement?.slice(0, 150));
      console.log('calculated_results:', JSON.stringify(rd.calculated_results, null, 2));
      console.log('required_cycles:', rd.required_cycles);
      console.log('actual_cycles_completed:', rd.actual_cycles_completed);
      console.log('crack_observed:', rd.crack_observed);
      console.log('photos:', (rd.photos || []).map((p) => ({ slot: p.slot, label: p.label, url: p.url })));
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
