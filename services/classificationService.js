// Maps standard method codes to in-house test IDs
const INHOUSE_METHOD_MAP = {
  'SATRA TM 174':   'SATRA-TM-174',
  'SATRA TM 92':    'SATRA-TM-92',
  'SATRA TM 161':   'SATRA-TM-161',
  'SATRA TM 281':   'SATRA-TM-281',
  'SATRA TM 31':    'SATRA-TM-31',
  'ISO 19574':      'ISO-19574',
  'ISO 19574:2022': 'ISO-19574'
};

// Maps test name keywords to in-house test IDs
// Used as fallback when no standard method is present
const INHOUSE_NAME_MAP = {
  'sole abrasion':      'SATRA-TM-174',
  'sole flexing':       'SATRA-TM-92',
  'whole shoe flexing': 'SATRA-TM-161',
  'shoe flexing':       'SATRA-TM-161',
  'bond strength':      'SATRA-TM-281',
  'tensile':            'SATRA-TM-281',
  'ph value':           'PH-001',
  'ph test':            'PH-001',
  'antifungal':         'ISO-19574',
  'anti fungal':        'ISO-19574',
  'freezing':           'FZ-001',
  'freeze test':        'FZ-001',
  'hot air oven':       'HAO-001',
  'material abrasion':  'SATRA-TM-31',
  'martindale':         'SATRA-TM-31'
};

// Keywords that indicate Raw Material category
const RAW_MATERIAL_KEYWORDS = [
  'phenol',
  'lead',
  'cadmium',
  'arsenic',
  'organotin',
  'phthalate',
  'pah',
  'polycyclic',
  'flame retard',
  'sccp',
  'mccp',
  'dmfu',
  'dimethylfumarate',
  'chlorinated',
  'mercaptobenzothiazole',
  'mbt',
  'formamide',
  'propanol',
  'acetophenone',
  'global migration',
  'migration',
  'heavy metal',
  'napthalene',
  'naphthalene',
  'reach',
  'ph value',
  'ph test',
  'chemical'
];

// Keywords that indicate Finished Good category
const FINISHED_GOOD_KEYWORDS = [
  'sole abrasion',
  'abrasion',
  'flexing',
  'hardness',
  'slip resistance',
  'slip',
  'blooming',
  'non-marking',
  'non marking',
  'bond strength',
  'tensile',
  'whole shoe',
  'shoe flex',
  'ross flex'
];

/**
 * Assign category based on test name keywords
 * @param {string} testName - The test name to categorize
 * @returns {string} - Category: 'Raw Material', 'Work In Progress', or 'Finished Good'
 */
const assignCategory = (testName) => {
  const name = (testName || '').toLowerCase();

  if (RAW_MATERIAL_KEYWORDS.some(k => name.includes(k))) {
    return 'Raw Material';
  }
  if (FINISHED_GOOD_KEYWORDS.some(k => name.includes(k))) {
    return 'Finished Good';
  }
  return 'Work In Progress';
};

/**
 * Assign execution type and in-house test ID
 * @param {string} testName - The test name
 * @param {string} standardMethod - The standard method code
 * @returns {Object} - { execution_type, inhouse_test_id }
 */
const assignExecution = (testName, standardMethod) => {
  const name = (testName || '').toLowerCase();
  const method = (standardMethod || '').toUpperCase();

  // Check method map first — most reliable signal
  for (const [key, value] of Object.entries(INHOUSE_METHOD_MAP)) {
    if (method.includes(key.toUpperCase())) {
      return { execution_type: 'inhouse', inhouse_test_id: value };
    }
  }

  // Fall back to name keyword matching
  for (const [key, value] of Object.entries(INHOUSE_NAME_MAP)) {
    if (name.includes(key)) {
      return { execution_type: 'inhouse', inhouse_test_id: value };
    }
  }

  // Default: outsource
  return { execution_type: 'outsource', inhouse_test_id: null };
};

/**
 * Process extracted data from Reducto and add classification
 * @param {Object} reductoData - Raw data from Reducto extraction
 * @returns {Object} - Processed data with classification
 */
const processExtractedData = (reductoData) => {
  // Per Reducto docs: result is an ARRAY — always access index [0]
  const raw = reductoData.result[0];

  if (!raw) {
    throw new Error('Reducto returned empty result array');
  }

  if (!raw.tests || !Array.isArray(raw.tests)) {
    throw new Error('No tests array found in Reducto extraction result');
  }

  const processedTests = raw.tests.map((test, index) => {
    const category = assignCategory(test.test_name);
    const { execution_type, inhouse_test_id } = assignExecution(
      test.test_name,
      test.standard_method
    );

    return {
      // Internal ID for React key prop
      id: `extracted-row-${index}`,

      // From Reducto extraction
      serial_number: test.serial_number || index + 1,
      test_name: test.test_name || '',
      standard_method: test.standard_method || null,
      client_requirement: test.client_requirement || '',
      notes: test.notes || null,

      // From classification logic
      category,
      execution_type,
      inhouse_test_id,

      // Outsource fields — empty, admin fills in Step 4 UI
      vendor_name: '',
      vendor_contact: '',
      vendor_email: '',
      expected_report_date: null,

      // Assignment fields — empty until order is created
      assigned_tester_id: null,
      test_deadline: null,

      // UI state flags
      isEditing: false,
      hasError: false
    };
  });

  // Summary counts for UI display
  const meta = {
    total_tests_found: processedTests.length,
    inhouse_count: processedTests.filter(t => t.execution_type === 'inhouse').length,
    outsource_count: processedTests.filter(t => t.execution_type === 'outsource').length,
    raw_material_count: processedTests.filter(t => t.category === 'Raw Material').length,
    wip_count: processedTests.filter(t => t.category === 'Work In Progress').length,
    finished_good_count: processedTests.filter(t => t.category === 'Finished Good').length
  };

  return {
    component: raw.component || null,
    tests: processedTests,
    extraction_meta: meta,
    reducto_job_id: reductoData.job_id
  };
};

module.exports = {
  assignCategory,
  assignExecution,
  processExtractedData,
  INHOUSE_METHOD_MAP,
  INHOUSE_NAME_MAP
};
