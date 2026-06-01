require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { clearAllReportTemplates } = require('../services/reportTemplateService');

clearAllReportTemplates()
  .then((result) => {
    console.log('Template data cleared:', result);
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to clear template data:', error);
    process.exit(1);
  });
