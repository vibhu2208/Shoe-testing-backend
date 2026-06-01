const fs = require('fs/promises');
const path = require('path');
const dbAdapter = require('../config/dbAdapter');

const TEMPLATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS report_templates (
  id SERIAL PRIMARY KEY,
  template_key VARCHAR(255) UNIQUE NOT NULL,
  template_name VARCHAR(255) NOT NULL,
  template_path TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  source VARCHAR(50) DEFAULT 'system',
  is_active BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const GENERATED_REPORTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_test_id UUID,
  test_id VARCHAR(100),
  template_key VARCHAR(255),
  template_name VARCHAR(255),
  template_version INTEGER,
  report_url TEXT NOT NULL,
  report_status VARCHAR(30) DEFAULT 'generated',
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);
`;

const TEST_TEMPLATE_COLUMNS_SQL = `
ALTER TABLE tests
ADD COLUMN IF NOT EXISTS template_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS template_path TEXT,
ADD COLUMN IF NOT EXISTS template_key VARCHAR(255);
`;

const ARTICLE_TEST_TEMPLATE_COLUMNS_SQL = `
ALTER TABLE article_tests
ADD COLUMN IF NOT EXISTS template_key VARCHAR(255),
ADD COLUMN IF NOT EXISTS template_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS generated_report_id UUID;
`;

function normalizeKey(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/\.docx$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function listDocxFilesRecursive(baseDir, relative = '') {
  const currentDir = path.join(baseDir, relative);
  const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const relPath = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      const nested = await listDocxFilesRecursive(baseDir, relPath);
      files.push(...nested);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.docx')) {
      files.push(relPath);
    }
  }

  return files;
}

function getTemplateDirectories() {
  const backendRoot = path.resolve(__dirname, '..');
  return [
    path.resolve(backendRoot, '..', 'frontend', 'public'),
    path.join(backendRoot, 'report-templates'),
    path.join(backendRoot, 'uploads', 'report-templates')
  ];
}

async function ensureTemplateSchema() {
  await dbAdapter.execute(TEMPLATE_TABLE_SQL);
  await dbAdapter.execute(GENERATED_REPORTS_TABLE_SQL);
  await dbAdapter.execute(ARTICLE_TEST_TEMPLATE_COLUMNS_SQL).catch(() => {});
  await dbAdapter.execute(TEST_TEMPLATE_COLUMNS_SQL).catch(() => {});
}

async function upsertTemplate({ templateKey, templateName, templatePath, fileName, source = 'system' }) {
  return dbAdapter.execute(
    `INSERT INTO report_templates (template_key, template_name, template_path, file_name, source, is_active, version)
     VALUES ($1, $2, $3, $4, $5, true, 1)
     ON CONFLICT (template_key) DO UPDATE
       SET template_name = EXCLUDED.template_name,
           template_path = EXCLUDED.template_path,
           file_name = EXCLUDED.file_name,
           source = EXCLUDED.source,
           is_active = true,
           version = report_templates.version + 1,
           updated_at = NOW()`,
    [templateKey, templateName, templatePath, fileName, source]
  );
}

async function seedTemplatesFromFolders() {
  await ensureTemplateSchema();
  const dirs = getTemplateDirectories();
  const seen = new Set();
  let seededCount = 0;

  for (const dir of dirs) {
    const relFiles = await listDocxFilesRecursive(dir);
    for (const relFile of relFiles) {
      const fileName = path.basename(relFile);
      const key = normalizeKey(fileName);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const templatePath = path.join(dir, relFile);
      await upsertTemplate({
        templateKey: key,
        templateName: fileName.replace(/\.docx$/i, ''),
        templatePath,
        fileName,
        source: dir.includes('frontend') ? 'frontend_public' : 'backend_storage'
      });
      seededCount += 1;
    }
  }

  const templates = await dbAdapter.query(
    `SELECT template_key, template_name, template_path
     FROM report_templates
     WHERE is_active = true
     ORDER BY template_name`
  );

  for (const template of templates) {
    await dbAdapter.execute(
      `UPDATE tests
       SET template_key = COALESCE(template_key, $1),
           template_name = COALESCE(template_name, $2),
           template_path = COALESCE(template_path, $3)
       WHERE LOWER(REPLACE(name, ' ', '_')) = $1
          OR LOWER(REPLACE(name, ' ', '_')) LIKE '%' || $1 || '%'
          OR LOWER(REPLACE(id, '-', '_')) = $1`,
      [template.template_key, template.template_name, template.template_path]
    ).catch(() => {});
  }

  return { seededCount, totalActive: templates.length };
}

async function removePathIfExists(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
}

async function clearTemplateFilesOnDisk() {
  const backendRoot = path.resolve(__dirname, '..');
  const frontendPublic = path.resolve(backendRoot, '..', 'frontend', 'public');

  await removePathIfExists(path.join(backendRoot, 'uploads', 'report-templates'));
  await removePathIfExists(path.join(backendRoot, 'report-templates'));
  await removePathIfExists(path.join(backendRoot, 'reports', 'generated'));
  await removePathIfExists(path.join(frontendPublic, 'report-templates'));

  const publicEntries = await fs.readdir(frontendPublic, { withFileTypes: true }).catch(() => []);
  for (const entry of publicEntries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.docx')) {
      await fs.unlink(path.join(frontendPublic, entry.name)).catch(() => {});
    }
  }

  await fs.mkdir(path.join(backendRoot, 'uploads', 'report-templates'), { recursive: true });
  await fs.mkdir(path.join(backendRoot, 'reports', 'generated'), { recursive: true });
  await fs.mkdir(path.join(frontendPublic, 'report-templates'), { recursive: true });
}

async function clearAllReportTemplates() {
  await ensureTemplateSchema();

  const generatedReports = await dbAdapter.execute('DELETE FROM generated_reports');
  const reportTemplates = await dbAdapter.execute('DELETE FROM report_templates');

  const testsCleared = await dbAdapter.execute(
    `UPDATE tests
     SET template_name = NULL, template_path = NULL, template_key = NULL`
  );

  const articleTestsCleared = await dbAdapter.execute(
    `UPDATE article_tests
     SET template_key = NULL,
         template_name = NULL,
         generated_report_id = NULL,
         report_url = NULL,
         report_generated = false,
         report_generated_at = NULL,
         report_number = NULL`
  );

  await dbAdapter.execute(
    `UPDATE periodic_test_runs SET report_url = NULL, updated_at = NOW() WHERE report_url IS NOT NULL`
  ).catch(() => {});

  await clearTemplateFilesOnDisk();

  return {
    deletedReportTemplates: reportTemplates.rowCount ?? 0,
    deletedGeneratedReports: generatedReports.rowCount ?? 0,
    clearedTestMappings: testsCleared.rowCount ?? 0,
    clearedArticleTestReports: articleTestsCleared.rowCount ?? 0
  };
}

async function findTemplateForTest({ testId, testName, templateKey }) {
  await ensureTemplateSchema();

  const requestedKey = normalizeKey(templateKey);
  const nameKey = normalizeKey(testName);
  const idKey = normalizeKey(testId);

  const query = await dbAdapter.query(
    `SELECT template_key, template_name, template_path, file_name, version
     FROM report_templates
     WHERE is_active = true
       AND (
         template_key = $1
         OR template_key = $2
         OR template_key = $3
         OR template_name ILIKE $4
       )
     ORDER BY
       CASE
         WHEN template_key = $1 THEN 1
         WHEN template_key = $2 THEN 2
         WHEN template_key = $3 THEN 3
         ELSE 4
       END,
       updated_at DESC
     LIMIT 1`,
    [requestedKey, nameKey, idKey, `%${String(testName || '').trim()}%`]
  );

  if (query[0]) return query[0];

  const testRows = await dbAdapter.query(
    `SELECT template_key, template_name, template_path
     FROM tests
     WHERE id = $1
        OR template_key = $2
        OR template_key = $3
        OR LOWER(REPLACE(name, ' ', '_')) = $3
     LIMIT 1`,
    [String(testId || '').trim(), requestedKey, idKey]
  );

  const mapped = testRows[0];
  if (!mapped?.template_path) return null;

  return {
    template_key: mapped.template_key,
    template_name: mapped.template_name,
    template_path: mapped.template_path,
    file_name: path.basename(mapped.template_path),
    version: 1
  };
}

module.exports = {
  ensureTemplateSchema,
  seedTemplatesFromFolders,
  clearAllReportTemplates,
  normalizeKey,
  findTemplateForTest,
  upsertTemplate
};
