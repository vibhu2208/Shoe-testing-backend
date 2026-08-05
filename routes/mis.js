const express = require('express');
const dbAdapter = require('../config/dbAdapter');
const ExcelJS = require('exceljs');
const router = express.Router();

async function ensureVendorJoinReady() {
  await dbAdapter.execute(`
    CREATE TABLE IF NOT EXISTS vendors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      contact_person VARCHAR(255),
      email VARCHAR(255),
      phone VARCHAR(50),
      address TEXT,
      notes TEXT,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await dbAdapter.execute(`
    ALTER TABLE article_tests
    ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL
  `);
}

router.use(async (req, res, next) => {
  try {
    await ensureVendorJoinReady();
    next();
  } catch (error) {
    next();
  }
});

router.get('/summary', async (req, res) => {
  try {
    const [statusRows, clientRows, outsourceRows, tatRows] = await Promise.all([
      dbAdapter.query(`
        SELECT status, COUNT(*)::int AS count
        FROM article_tests
        GROUP BY status
        ORDER BY count DESC
      `),
      dbAdapter.query(`
        SELECT c.company_name AS client_name, c.client_code,
          COUNT(at.id)::int AS total,
          COUNT(*) FILTER (WHERE at.status NOT IN ('submitted','pass','fail'))::int AS pending,
          COUNT(*) FILTER (
            WHERE at.test_deadline < CURRENT_DATE
              AND at.status NOT IN ('submitted','pass','fail')
          )::int AS overdue
        FROM clients c
        JOIN articles a ON a.client_id = c.id
        JOIN article_tests at ON at.article_id = a.id
        GROUP BY c.id, c.company_name, c.client_code
        ORDER BY overdue DESC, pending DESC
        LIMIT 50
      `),
      dbAdapter.query(`
        SELECT
          COUNT(*) FILTER (WHERE execution_type IN ('outsource','both'))::int AS total_outsource,
          COUNT(*) FILTER (
            WHERE execution_type IN ('outsource','both')
              AND expected_report_date < CURRENT_DATE
              AND (outsourced_report_url IS NULL OR outsourced_report_url = '')
              AND status NOT IN ('submitted','pass','fail')
          )::int AS overdue_reports,
          COUNT(*) FILTER (
            WHERE execution_type IN ('outsource','both')
              AND outsourced_report_url IS NOT NULL AND outsourced_report_url <> ''
          )::int AS reports_received
        FROM article_tests
      `),
      dbAdapter.query(`
        SELECT
          ROUND(AVG(
            EXTRACT(EPOCH FROM (submitted_at - COALESCE(assigned_at, created_at))) / 86400.0
          )::numeric, 1) AS avg_tat_days,
          COUNT(*) FILTER (WHERE submitted_at IS NOT NULL)::int AS completed_with_tat
        FROM article_tests
        WHERE submitted_at IS NOT NULL
      `),
    ]);

    res.json({
      byStatus: statusRows,
      byClient: clientRows,
      outsource: outsourceRows[0] || {
        total_outsource: 0,
        overdue_reports: 0,
        reports_received: 0,
      },
      tat: tatRows[0] || { avg_tat_days: null, completed_with_tat: 0 },
    });
  } catch (error) {
    console.error('MIS summary error:', error);
    res.status(500).json({ error: 'Failed to load MIS summary' });
  }
});

router.get('/export', async (req, res) => {
  try {
    const rows = await dbAdapter.query(`
      SELECT
        c.company_name, c.client_code,
        a.article_number, a.article_name,
        at.test_name, at.execution_type, at.status,
        at.test_deadline, at.expected_report_date,
        at.vendor_name, at.outsourced_report_url,
        at.assigned_at, at.submitted_at, at.result
      FROM article_tests at
      JOIN articles a ON a.id = at.article_id
      JOIN clients c ON c.id = a.client_id
      ORDER BY c.company_name, a.article_number, at.test_name
    `);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('MIS');
    sheet.columns = [
      { header: 'Client', key: 'company_name', width: 24 },
      { header: 'Client Code', key: 'client_code', width: 14 },
      { header: 'Article', key: 'article_number', width: 16 },
      { header: 'Article Name', key: 'article_name', width: 22 },
      { header: 'Test', key: 'test_name', width: 28 },
      { header: 'Execution', key: 'execution_type', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Due Date', key: 'test_deadline', width: 14 },
      { header: 'Expected Report', key: 'expected_report_date', width: 14 },
      { header: 'Vendor', key: 'vendor_name', width: 20 },
      { header: 'Outsource Report', key: 'outsourced_report_url', width: 30 },
      { header: 'Assigned At', key: 'assigned_at', width: 18 },
      { header: 'Submitted At', key: 'submitted_at', width: 18 },
      { header: 'Result', key: 'result', width: 10 },
    ];
    rows.forEach((row) => sheet.addRow(row));

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="mis_report.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('MIS export error:', error);
    res.status(500).json({ error: 'Failed to export MIS' });
  }
});

router.get('/external-tests', async (req, res) => {
  try {
    const rows = await dbAdapter.query(`
      SELECT
        at.id, at.test_name, at.status, at.execution_type,
        at.expected_report_date, at.vendor_name, at.vendor_id,
        at.outsourced_report_url, at.vendor_email, at.vendor_contact,
        a.article_number, a.article_name, a.id AS article_id,
        c.company_name AS client_name, c.client_code,
        v.name AS vendor_master_name
      FROM article_tests at
      JOIN articles a ON a.id = at.article_id
      JOIN clients c ON c.id = a.client_id
      LEFT JOIN vendors v ON v.id = at.vendor_id
      WHERE at.execution_type IN ('outsource', 'both')
      ORDER BY at.expected_report_date ASC NULLS LAST, at.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('External tests list error:', error);
    res.status(500).json({ error: 'Failed to list external tests' });
  }
});

module.exports = router;
