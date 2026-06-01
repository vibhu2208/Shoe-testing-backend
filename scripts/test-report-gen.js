require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const testId = process.argv[2] || '7256ef98-a860-4a20-b389-43e9ec99df1b';
const { generateReportFromTemplate } = require('../services/docxReportGenerator');

generateReportFromTemplate({ testId })
  .then((result) => {
    console.log('Report generated:', result);
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
