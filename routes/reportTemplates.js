const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const dbAdapter = require('../config/dbAdapter');
const { generateReportFromTemplate } = require('../services/docxReportGenerator');
const {
  ensureTemplateSchema,
  seedTemplatesFromFolders,
  clearAllReportTemplates,
  upsertTemplate,
  normalizeKey
} = require('../services/reportTemplateService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/templates', async (_req, res) => {
  try {
    await ensureTemplateSchema();
    const templates = await dbAdapter.query(
      `SELECT id, template_key, template_name, file_name, template_path, source, version, updated_at
       FROM report_templates
       WHERE is_active = true
       ORDER BY updated_at DESC`
    );
    res.json({ templates });
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

router.post('/templates/clear', async (_req, res) => {
  try {
    const result = await clearAllReportTemplates();
    res.json({ message: 'All report template data cleared', ...result });
  } catch (error) {
    console.error('Clear templates error:', error);
    res.status(500).json({ error: 'Failed to clear template data' });
  }
});

router.post('/templates/seed', async (_req, res) => {
  try {
    const result = await seedTemplatesFromFolders();
    res.json({ message: 'Template seeding completed', ...result });
  } catch (error) {
    console.error('Seed templates error:', error);
    res.status(500).json({ error: 'Failed to seed templates' });
  }
});

router.post('/templates/upload', upload.single('template'), async (req, res) => {
  try {
    await ensureTemplateSchema();
    if (!req.file || !req.file.originalname?.toLowerCase().endsWith('.docx')) {
      return res.status(400).json({ error: 'A .docx template file is required' });
    }

    const incomingKey = req.body?.templateKey ? normalizeKey(req.body.templateKey) : null;
    const templateKey = incomingKey || normalizeKey(req.file.originalname);
    const templateName = String(req.body?.templateName || req.file.originalname.replace(/\.docx$/i, '')).trim();

    const dir = path.resolve(__dirname, '..', 'uploads', 'report-templates', templateKey);
    await fs.mkdir(dir, { recursive: true });
    const fileName = `${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const absPath = path.join(dir, fileName);
    await fs.writeFile(absPath, req.file.buffer);

    await upsertTemplate({
      templateKey,
      templateName,
      templatePath: absPath,
      fileName,
      source: 'admin_upload'
    });

    res.status(201).json({ message: 'Template uploaded', templateKey, templateName });
  } catch (error) {
    console.error('Upload template error:', error);
    res.status(500).json({ error: 'Failed to upload template' });
  }
});

router.get('/templates/by-test/:testId', async (req, res) => {
  try {
    const rows = await dbAdapter.query(
      `SELECT id, name, template_key, template_name, template_path
       FROM tests
       WHERE id = $1`,
      [req.params.testId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Test not found' });
    res.json({ test: rows[0] });
  } catch (error) {
    console.error('Fetch template by test error:', error);
    res.status(500).json({ error: 'Failed to fetch template mapping' });
  }
});

router.post('/generate/:articleTestId', async (req, res) => {
  try {
    const generated = await generateReportFromTemplate({ testId: req.params.articleTestId });
    res.json(generated);
  } catch (error) {
    console.error('Generate templated report error:', error);
    res.status(400).json({ error: error.message || 'Failed to generate report' });
  }
});

router.get('/download/:articleTestId', async (req, res) => {
  try {
    const rows = await dbAdapter.query(
      `SELECT report_url, test_name FROM article_tests WHERE id = $1`,
      [req.params.articleTestId]
    );
    if (!rows.length || !rows[0].report_url) {
      return res.status(404).json({ error: 'Report not found' });
    }
    const reportUrl = rows[0].report_url;
    const absPath = path.resolve(__dirname, '..', String(reportUrl).replace(/^\//, ''));
    await fs.access(absPath);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${String(rows[0].test_name || 'report').replace(/[^a-zA-Z0-9_-]/g, '_')}.docx"`);
    res.sendFile(absPath);
  } catch (error) {
    console.error('Download templated report error:', error);
    res.status(500).json({ error: 'Failed to download report' });
  }
});

router.get('/history', async (_req, res) => {
  try {
    await ensureTemplateSchema();
    const rows = await dbAdapter.query(
      `SELECT
        gr.id,
        gr.article_test_id,
        gr.template_key,
        gr.template_name,
        gr.report_url,
        gr.report_status,
        gr.generated_at,
        at.test_name,
        at.result,
        a.article_name,
        c.company_name AS client_name
      FROM generated_reports gr
      LEFT JOIN article_tests at ON at.id = gr.article_test_id
      LEFT JOIN articles a ON a.id = at.article_id
      LEFT JOIN clients c ON c.id = a.client_id
      ORDER BY gr.generated_at DESC
      LIMIT 200`
    );
    res.json({ reports: rows });
  } catch (error) {
    console.error('Report history error:', error);
    res.status(500).json({ error: 'Failed to fetch report history' });
  }
});

module.exports = router;
