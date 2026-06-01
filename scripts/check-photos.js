require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const dbAdapter = require('../config/dbAdapter');
const fsSync = require('fs');
const path = require('path');

const testId = process.argv[2] || '7256ef98-a860-4a20-b389-43e9ec99df1b';
const backendRoot = path.resolve(__dirname, '..');

dbAdapter
  .query(`SELECT result_data FROM article_tests WHERE id = $1`, [testId])
  .then((rows) => {
    const photos = rows[0]?.result_data?.photos || [];
    console.log('Photos in DB:', photos.length);
    photos.forEach((p) => {
      const abs = path.join(backendRoot, String(p.url || '').replace(/^\//, ''));
      console.log(`  slot ${p.slot}: ${p.label} exists=${fsSync.existsSync(abs)} url=${p.url}`);
    });
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
