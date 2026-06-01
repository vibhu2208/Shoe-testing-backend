require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const dbAdapter = require('../config/dbAdapter');
const { ensureTemplateSchema, upsertTemplate, normalizeKey } = require('../services/reportTemplateService');

const TEMPLATE_FILE = '16 BOND TEST NEW.docx';
const TEST_ID = 'SATRA-TM-281';

async function main() {
  const templatePath = path.resolve(__dirname, '..', '..', 'frontend', 'public', TEMPLATE_FILE);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  await ensureTemplateSchema();
  const templateKey = normalizeKey(TEMPLATE_FILE);
  const templateName = TEMPLATE_FILE.replace(/\.docx$/i, '');

  await upsertTemplate({
    templateKey,
    templateName,
    templatePath,
    fileName: TEMPLATE_FILE,
    source: 'frontend_public'
  });

  await dbAdapter.execute(
    `UPDATE tests
     SET template_key = $1, template_name = $2, template_path = $3
     WHERE id = $4`,
    [templateKey, templateName, templatePath, TEST_ID]
  );

  const rows = await dbAdapter.query(
    `SELECT id, name, template_key, template_path FROM tests WHERE id = $1`,
    [TEST_ID]
  );

  console.log('Bond template registered:', { templateKey, templatePath, test: rows[0] });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
