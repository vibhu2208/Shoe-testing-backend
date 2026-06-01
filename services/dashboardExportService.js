const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const archiver = require('archiver');
const XLSX = require('xlsx');
const dbAdapter = require('../config/dbAdapter');

const BACKEND_ROOT = path.resolve(__dirname, '..');

function getDateRangeStart(dateRange) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  switch (dateRange) {
    case 'today':
      return start;
    case 'week':
      start.setDate(start.getDate() - 7);
      return start;
    case 'month':
      start.setMonth(start.getMonth() - 1);
      return start;
    case 'quarter':
      start.setMonth(start.getMonth() - 3);
      return start;
    case 'year':
      start.setFullYear(start.getFullYear() - 1);
      return start;
    default:
      start.setMonth(start.getMonth() - 1);
      return start;
  }
}

function resolveReportPath(reportUrl) {
  if (!reportUrl) return null;
  const normalized = String(reportUrl).replace(/^\//, '');
  const absPath = path.resolve(BACKEND_ROOT, normalized);
  if (!absPath.startsWith(BACKEND_ROOT)) return null;
  return absPath;
}

async function fetchFilteredTests({ clientId, testId, dateRange, search }) {
  const conditions = [];
  const params = [];

  if (clientId) {
    params.push(clientId);
    conditions.push(`c.id = $${params.length}`);
  }

  if (testId) {
    params.push(testId);
    conditions.push(
      `(at.inhouse_test_id = $${params.length} OR at.test_standard ILIKE $${params.length + 1} OR at.test_name ILIKE $${params.length + 2})`,
    );
    params.push(`%${testId.replace(/-/g, ' ')}%`, `%${testId}%`);
  }

  if (dateRange) {
    params.push(getDateRangeStart(dateRange).toISOString());
    conditions.push(
      `COALESCE(at.report_generated_at, at.submitted_at, at.assigned_at, at.created_at) >= $${params.length}`,
    );
  }

  if (search) {
    const term = `%${search.trim()}%`;
    params.push(term, term, term, term);
    const base = params.length - 3;
    conditions.push(
      `(at.test_name ILIKE $${base} OR c.company_name ILIKE $${base + 1} OR a.article_name ILIKE $${base + 2} OR COALESCE(at.report_number, '') ILIKE $${base + 3})`,
    );
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await dbAdapter.query(
    `SELECT
      at.id,
      at.test_name,
      at.test_standard,
      at.inhouse_test_id,
      at.status,
      at.result,
      at.report_generated,
      at.report_url,
      at.report_number,
      at.report_generated_at,
      at.test_deadline,
      at.created_at,
      a.article_name,
      a.article_number,
      a.material_type,
      c.id AS client_id,
      c.company_name,
      u.name AS tester_name
    FROM article_tests at
    JOIN articles a ON a.id = at.article_id
    JOIN clients c ON c.id = a.client_id
    LEFT JOIN users u ON u.id = at.assigned_tester_id
    ${whereClause}
    ORDER BY c.company_name, at.report_generated_at DESC NULLS LAST, at.created_at DESC`,
    params,
  );

  return rows;
}

function buildWorkbookRows(rows) {
  return rows.map((row) => ({
    'Sample / Test ID': row.id,
    Client: row.company_name,
    'Article Name': row.article_name,
    'Article Number': row.article_number,
    'Material Type': row.material_type,
    'Test Name': row.test_name,
    Standard: row.test_standard,
    'Library Test ID': row.inhouse_test_id,
    Status: row.status,
    Result: row.result || '',
    'Report Generated': row.report_generated ? 'Yes' : 'No',
    'Report Number': row.report_number || '',
    'Report Date': row.report_generated_at
      ? new Date(row.report_generated_at).toISOString().slice(0, 10)
      : '',
    'Test Deadline': row.test_deadline || '',
    Technician: row.tester_name || '',
  }));
}

function buildExcelBuffer(rows) {
  const sheetRows = buildWorkbookRows(rows);
  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Tests');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

async function buildReportsZip(rows, { clientId, testId } = {}) {
  const reportRows = rows.filter((row) => row.report_generated && row.report_url);
  if (reportRows.length === 0) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 6 } });
    let filesAdded = 0;

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => {
      if (filesAdded === 0) {
        resolve(null);
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    const usedNames = new Set();

    for (const row of reportRows) {
      const absPath = resolveReportPath(row.report_url);
      if (!absPath) continue;

      try {
        if (!fsSync.existsSync(absPath)) continue;
      } catch {
        continue;
      }

      const safeClient = String(row.company_name || 'client').replace(/[^a-zA-Z0-9 _-]/g, '_');
      const safeTest = String(row.report_number || row.test_name || 'report').replace(/[^a-zA-Z0-9 _-]/g, '_');
      let entryName = `${safeClient}/${safeTest}.docx`;
      let counter = 1;
      while (usedNames.has(entryName)) {
        counter += 1;
        entryName = `${safeClient}/${safeTest}_${counter}.docx`;
      }
      usedNames.add(entryName);
      archive.file(absPath, { name: entryName });
      filesAdded += 1;
    }

    const manifest = {
      exportedAt: new Date().toISOString(),
      clientId: clientId || null,
      testId: testId || null,
      totalTests: rows.length,
      totalReports: reportRows.length,
      filesAdded,
      items: reportRows.map((row) => ({
        id: row.id,
        client: row.company_name,
        testName: row.test_name,
        reportNumber: row.report_number,
      })),
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'export-manifest.json' });

    const summaryBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(summaryBook, XLSX.utils.json_to_sheet(buildWorkbookRows(rows)), 'Tests');
    archive.append(XLSX.write(summaryBook, { type: 'buffer', bookType: 'xlsx' }), {
      name: 'tests-summary.xlsx',
    });

    archive.finalize();
  });
}

async function exportDashboardData(filters) {
  const rows = await fetchFilteredTests(filters);

  if (rows.length === 0) {
    const error = new Error('No tests found for the selected filters.');
    error.statusCode = 404;
    throw error;
  }

  const shouldZip =
    Boolean(filters.clientId) ||
    (Boolean(filters.testId) && rows.some((row) => row.report_generated && row.report_url));

  if (shouldZip) {
    const zipBuffer = await buildReportsZip(rows, filters);
    if (zipBuffer && zipBuffer.length > 0) {
      const clientPart = filters.clientId
        ? String(rows[0]?.company_name || 'client').replace(/[^a-zA-Z0-9_-]/g, '_')
        : 'filtered';
      const testPart = filters.testId ? String(filters.testId).replace(/[^a-zA-Z0-9_-]/g, '_') : 'all-tests';
      return {
        type: 'zip',
        buffer: zipBuffer,
        filename: `lab-reports_${clientPart}_${testPart}_${Date.now()}.zip`,
      };
    }
  }

  const excelBuffer = buildExcelBuffer(rows);
  return {
    type: 'xlsx',
    buffer: excelBuffer,
    filename: `lab-tests-export_${Date.now()}.xlsx`,
  };
}

module.exports = {
  exportDashboardData,
  fetchFilteredTests,
};
