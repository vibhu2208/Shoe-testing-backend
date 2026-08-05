const ExcelJS = require('exceljs');
const dbAdapter = require('../config/dbAdapter');
const { TEST_LIBRARY_METADATA } = require('../data/testLibraryMetadata');

const ARTICLE_HEADERS = [
  'articleNumber',
  'articleName',
  'materialType',
  'color',
  'description',
  'testName',
  'standard',
  'clientRequirement',
  'category',
  'executionType',
  'inhouseTestId',
  'vendorName',
  'vendorContact',
  'vendorEmail',
  'expectedReportDate',
  'testDeadline',
  'notes'
];

const FALLBACK_TESTS = [
  { id: 'SATRA-TM-174', name: 'Sole Abrasion', standard: 'SATRA TM 174', category: 'Finished Good' },
  { id: 'SATRA-TM-92', name: 'Sole Flexing', standard: 'SATRA TM 92', category: 'Finished Good' },
  { id: 'SATRA-TM-161', name: 'Whole Shoe Flexing', standard: 'SATRA TM 161', category: 'Finished Good' },
  { id: 'SATRA-TM-281', name: 'Bond Strength', standard: 'SATRA TM 281', category: 'Finished Good' },
  { id: 'PH-001', name: 'pH Value', standard: 'PH-001', category: 'Raw Material' },
  { id: 'ISO-19574', name: 'Antifungal', standard: 'ISO 19574', category: 'Finished Good' },
  { id: 'FZ-001', name: 'Freezing', standard: 'FZ-001', category: 'Finished Good' },
  { id: 'HAO-001', name: 'Hot Air Oven', standard: 'HAO-001', category: 'Finished Good' },
  { id: 'SATRA-TM-31', name: 'Material Abrasion', standard: 'SATRA TM 31', category: 'Raw Material' }
];

const CATEGORY_OPTIONS = ['Raw Material', 'WIP', 'Finished Good'];
const EXECUTION_OPTIONS = ['inhouse', 'outsource', 'both'];
const DATA_ROW_START = 2;
const DATA_ROW_END = 500;

const headerStyle = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } },
  alignment: { vertical: 'middle', wrapText: true }
};

function applyHeaderStyle(cell) {
  cell.font = headerStyle.font;
  cell.fill = headerStyle.fill;
  cell.alignment = headerStyle.alignment;
}

const instructionStyle = {
  font: { bold: true, size: 12 }
};

async function fetchLibraryTests() {
  try {
    const rows = await dbAdapter.query(
      'SELECT id, name, standard, category FROM tests ORDER BY category, name'
    );
    if (rows.length > 0) {
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        standard: row.standard || row.id,
        category: row.category || 'Finished Good'
      }));
    }
  } catch (error) {
    console.warn('Could not load tests for bulk template, using fallback list:', error.message);
  }

  const metadataIds = Object.keys(TEST_LIBRARY_METADATA);
  if (metadataIds.length > 0) {
    const fallbackById = new Map(FALLBACK_TESTS.map((test) => [test.id, test]));
    return metadataIds.map((id) => fallbackById.get(id) || {
      id,
      name: id,
      standard: id,
      category: 'Finished Good'
    });
  }

  return FALLBACK_TESTS;
}

function addListValidation(worksheet, range, formula) {
  worksheet.dataValidations.add(range, {
    type: 'list',
    allowBlank: true,
    formulae: [formula],
    showErrorMessage: true,
    errorStyle: 'warning',
    errorTitle: 'Invalid selection',
    error: 'Choose a value from the dropdown list.'
  });
}

function buildInstructionsSheet(workbook) {
  const sheet = workbook.addWorksheet('Instructions');
  sheet.getColumn(1).width = 100;

  const lines = [
    'Admin Article Bulk Upload — Instructions',
    '',
    'For lab/admin use only — import many articles and tests at once.',
    '1. Fill one row per test. Repeat articleNumber + articleName for each test on the same article.',
    '2. Required columns: articleNumber, articleName, and at least one test (testName or inhouseTestId).',
    '3. Use dropdowns on the Articles sheet for testName, inhouseTestId, category, and executionType.',
    '4. Pick inhouseTestId OR testName from the Test Library — standard and category can be left blank for in-house tests.',
    '5. clientRequirement is what the client wants (e.g. "Max wear <= 200 mm3", "Min bond 2.5 N/mm").',
    '6. executionType: inhouse | outsource | both. Fill vendor columns only for outsource/both.',
    '7. Dates: YYYY-MM-DD (e.g. 2026-04-10).',
    '8. Do not rename sheet headers or the Test Library sheet.',
    '9. Upload the filled file from New Article → Bulk Upload in the client profile.',
    '',
    'Test Library reference (read-only): see the "TestLibrary" sheet.'
  ];

  lines.forEach((line, index) => {
    const row = sheet.getRow(index + 1);
    row.getCell(1).value = line;
    if (index === 0) {
      row.getCell(1).font = instructionStyle.font;
    }
  });
}

function buildTestLibrarySheet(workbook, tests) {
  const sheet = workbook.addWorksheet('TestLibrary');
  const headers = ['inhouseTestId', 'testName', 'standard', 'category', 'description'];
  sheet.addRow(headers);
  sheet.getRow(1).eachCell((cell) => applyHeaderStyle(cell));

  tests.forEach((test) => {
    sheet.addRow([
      test.id,
      test.name,
      test.standard,
      test.category,
      `Select this test for in-house execution (${test.id})`
    ]);
  });

  sheet.columns = [
    { width: 18 },
    { width: 28 },
    { width: 18 },
    { width: 16 },
    { width: 42 }
  ];

  return sheet;
}

function buildArticlesSheet(workbook, tests) {
  const sheet = workbook.addWorksheet('articles');
  sheet.addRow(ARTICLE_HEADERS);
  sheet.getRow(1).eachCell((cell) => applyHeaderStyle(cell));

  sheet.addRow([
    'ART-001',
    'Runner Shoe Model X',
    'Synthetic',
    'Black',
    'Sports shoe upper and sole assembly',
    tests[0]?.name || 'Sole Abrasion',
    tests[0]?.standard || 'SATRA TM 174',
    'Max wear <= 200 mm3',
    tests[0]?.category || 'Finished Good',
    'inhouse',
    tests[0]?.id || 'SATRA-TM-174',
    '',
    '',
    '',
    '',
    '2026-04-10',
    'Priority sample'
  ]);

  sheet.columns = [
    { width: 14 },
    { width: 24 },
    { width: 14 },
    { width: 12 },
    { width: 28 },
    { width: 24 },
    { width: 16 },
    { width: 28 },
    { width: 16 },
    { width: 14 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 22 },
    { width: 18 },
    { width: 14 },
    { width: 20 }
  ];

  const libraryLastRow = tests.length + 1;
  const idRange = `'TestLibrary'!$A$2:$A$${libraryLastRow}`;
  const nameRange = `'TestLibrary'!$B$2:$B$${libraryLastRow}`;

  addListValidation(sheet, `F${DATA_ROW_START}:F${DATA_ROW_END}`, nameRange);
  addListValidation(sheet, `K${DATA_ROW_START}:K${DATA_ROW_END}`, idRange);
  addListValidation(sheet, `I${DATA_ROW_START}:I${DATA_ROW_END}`, `"${CATEGORY_OPTIONS.join(',')}"`);
  addListValidation(sheet, `J${DATA_ROW_START}:J${DATA_ROW_END}`, `"${EXECUTION_OPTIONS.join(',')}"`);

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  return sheet;
}

const CLIENT_TEST_HEADERS = ['testName', 'standard', 'clientRequirement', 'description'];

const normalizeCell = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const mapLibraryCategory = (category) => {
  if (category === 'WIP') return 'Work In Progress';
  return category || 'Work In Progress';
};

function buildLibraryLookup(tests) {
  const byId = new Map();
  const byName = new Map();
  const byStandard = new Map();

  tests.forEach((test) => {
    byId.set(String(test.id).toUpperCase(), test);
    byName.set(String(test.name).trim().toLowerCase(), test);
    if (test.standard) {
      byStandard.set(String(test.standard).trim().toLowerCase(), test);
    }
  });

  return { byId, byName, byStandard };
}

function resolveLibraryMatch(row, lookup) {
  const testName = normalizeCell(row.testName);
  const standard = normalizeCell(row.standard);

  return (
    (testName ? lookup.byName.get(testName.toLowerCase()) : null)
    || (standard ? lookup.byStandard.get(standard.toLowerCase()) : null)
    || (testName ? lookup.byId.get(testName.toUpperCase()) : null)
  );
}

function buildClientInstructionsSheet(workbook) {
  const sheet = workbook.addWorksheet('Instructions');
  sheet.getColumn(1).width = 100;

  const lines = [
    'Client Test Requirements — Instructions',
    '',
    'Fill one row per test your article needs.',
    'Required: testName and clientRequirement.',
    'Optional: standard (test method) and description (notes about the sample or test).',
    '',
    'Do NOT fill article details, vendor, or execution type — your lab handles those.',
    'Use the testName dropdown on the Tests sheet where possible.',
    'Examples for clientRequirement:',
    '  • Sole Abrasion: Max wear <= 200 mm3',
    '  • Bond Strength: Min bond 2.5 N/mm',
    '  • Flexing: 30000 cycles, no crack',
    '',
    'Return this file to your lab contact for import.'
  ];

  lines.forEach((line, index) => {
    const row = sheet.getRow(index + 1);
    row.getCell(1).value = line;
    if (index === 0) {
      row.getCell(1).font = instructionStyle.font;
    }
  });
}

function buildClientTestsSheet(workbook, tests) {
  const sheet = workbook.addWorksheet('Tests');
  sheet.addRow(CLIENT_TEST_HEADERS);
  sheet.getRow(1).eachCell((cell) => applyHeaderStyle(cell));

  sheet.addRow([
    tests[0]?.name || 'Sole Abrasion',
    tests[0]?.standard || 'SATRA TM 174',
    'Max wear <= 200 mm3',
    'Outsole rubber compound, black'
  ]);

  sheet.columns = [
    { width: 28 },
    { width: 20 },
    { width: 36 },
    { width: 36 }
  ];

  const libraryLastRow = tests.length + 1;
  const nameRange = `'TestLibrary'!$B$2:$B$${libraryLastRow}`;
  addListValidation(sheet, `A${DATA_ROW_START}:A${DATA_ROW_END}`, nameRange);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  return sheet;
}

async function buildClientTestRequirementsTemplateBuffer() {
  const tests = await fetchLibraryTests();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Virola LIMS';
  workbook.created = new Date();

  buildClientInstructionsSheet(workbook);
  buildTestLibrarySheet(workbook, tests);
  buildClientTestsSheet(workbook, tests);

  return workbook.xlsx.writeBuffer();
}

function parseClientRequirementRows(fileBuffer) {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const preferredNames = ['tests', 'clienttests', 'client_tests', 'testrequirements'];
  const sheetName = workbook.SheetNames.find((name) => preferredNames.includes(name.toLowerCase()))
    || workbook.SheetNames.find((name) => !['instructions', 'testlibrary', 'articles'].includes(name.toLowerCase()))
    || workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('No worksheet found in uploaded file');
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
}

async function parseClientTestRequirements(fileBuffer) {
  const rows = parseClientRequirementRows(fileBuffer);
  if (!rows.length) {
    throw new Error('No rows found in uploaded file');
  }

  const libraryTests = await fetchLibraryTests();
  const lookup = buildLibraryLookup(libraryTests);
  const tests = [];

  rows.forEach((row, index) => {
    const testName = normalizeCell(row.testName);
    const clientRequirement = normalizeCell(row.clientRequirement);
    const standard = normalizeCell(row.standard);
    const description = normalizeCell(row.description);

    if (!testName && !clientRequirement && !standard && !description) {
      return;
    }

    if (!testName) {
      throw new Error(`Row ${index + 2}: testName is required`);
    }
    if (!clientRequirement) {
      throw new Error(`Row ${index + 2}: clientRequirement is required`);
    }

    const libraryTest = resolveLibraryMatch(row, lookup);

    tests.push({
      id: `client-excel-row-${index + 1}`,
      serial_number: tests.length + 1,
      test_name: libraryTest?.name || testName,
      standard_method: standard || libraryTest?.standard || null,
      client_requirement: clientRequirement,
      category: mapLibraryCategory(libraryTest?.category),
      execution_type: 'outsource',
      inhouse_test_id: libraryTest?.id || null,
      vendor_name: '',
      vendor_contact: '',
      vendor_email: '',
      expected_report_date: null,
      assigned_tester_id: null,
      test_deadline: null,
      notes: description || null,
      isEditing: false,
      hasError: false
    });
  });

  if (!tests.length) {
    throw new Error('No test rows found in uploaded file');
  }

  return {
    component: null,
    tests,
    extraction_meta: {
      total_tests_found: tests.length,
      inhouse_count: tests.filter((test) => test.inhouse_test_id).length,
      outsource_count: tests.filter((test) => !test.inhouse_test_id).length,
      raw_material_count: tests.filter((test) => test.category === 'Raw Material').length,
      wip_count: tests.filter((test) => test.category === 'Work In Progress').length,
      finished_good_count: tests.filter((test) => test.category === 'Finished Good').length
    }
  };
}

async function buildArticleBulkTemplateBuffer() {
  const tests = await fetchLibraryTests();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Virola LIMS';
  workbook.created = new Date();

  buildInstructionsSheet(workbook);
  buildTestLibrarySheet(workbook, tests);
  buildArticlesSheet(workbook, tests);

  return workbook.xlsx.writeBuffer();
}

module.exports = {
  ARTICLE_HEADERS,
  CLIENT_TEST_HEADERS,
  buildArticleBulkTemplateBuffer,
  buildClientTestRequirementsTemplateBuffer,
  parseClientTestRequirements,
  fetchLibraryTests,
  FALLBACK_TESTS
};
