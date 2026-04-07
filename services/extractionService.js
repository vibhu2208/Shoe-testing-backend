const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');
const db = require('../config/dbAdapter');

/**
 * Upload file to Reducto platform
 * @param {string} filePath - Path to the file to upload
 * @returns {Promise<string>} - Reducto file ID
 */
const uploadToReducto = async (filePath) => {
  try {
    // Development mode: return mock file ID
    if (process.env.REDUCTO_MODE !== 'production') {
      console.log('🔧 Development mode: Using mock Reducto upload');
      const mockFileId = `mock_file_${Date.now()}`;
      console.log('Mock Reducto upload successful:', mockFileId);
      return mockFileId;
    }

    // Production mode: actual Reducto API call
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));

    const response = await fetch('https://platform.reducto.ai/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.REDUCTO_API_KEY}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Reducto upload failed: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Reducto upload successful:', data.file_id);
    return data.file_id;
  } catch (error) {
    console.error('Reducto upload error:', error);
    throw error;
  }
};

/**
 * Extract structured data from spec sheet using Reducto
 * @param {string} fileId - Reducto file ID from upload
 * @returns {Promise<Object>} - Extracted structured data
 */
const extractFromSpecSheet = async (fileId) => {
  try {
    // Development mode: return mock extraction data
    if (process.env.REDUCTO_MODE !== 'production') {
      console.log('🔧 Development mode: Using mock Reducto extraction');
      const mockData = {
        job_id: `mock_job_${Date.now()}`,
        result: [{
          component: {
            name: "EVA Material",
            material_type: "EVA",
            color: null
          },
          tests: [
            {
              serial_number: 1,
              test_name: "Phenols – Others",
              standard_method: null,
              client_requirement: "Phenol: Pass < 30 mg/kg | 2,6-Dimethylphenol / p-Phenylphenol / Tribromphenol: Pass < 50 mg/kg | NP / OP: Pass < 30 mg/kg",
              notes: "Multiple compounds each with different threshold"
            },
            {
              serial_number: 19,
              test_name: "Sole Abrasion (Method: SATRA TM 174)",
              standard_method: "SATRA TM 174",
              client_requirement: "< 200 g/mm³",
              notes: null
            },
            {
              serial_number: 18,
              test_name: "Blooming (Method: SATRA TM 344)",
              standard_method: "SATRA TM 344", 
              client_requirement: "Condition: 70°C / 95% RH / 168 hrs | Requirement: No Blooming",
              notes: "Specific test conditions required — 70°C, 95% RH, 168 hours duration"
            }
          ]
        }],
        usage: { num_fields: 4, num_pages: 1, credits: 5.0 }
      };
      console.log('Mock Reducto extraction successful:', mockData.job_id);
      return mockData;
    }

    // Production mode: actual Reducto API call
    const response = await fetch('https://platform.reducto.ai/extract', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.REDUCTO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: fileId,
        instructions: {
          system_prompt: `This document is a footwear material quality testing specification sheet submitted by a client to a testing laboratory called Virola Assure Labs.

The document contains two tables:

TABLE 1 — Small component table at the very top:
Columns: S.No | Component Name | Material Type | Color
Extract this as the component object. There is always exactly one data row.

TABLE 2 — Large test requirements table:
Columns: S.No | Test Name | Requirement
Extract every single row as an item in the tests array.

CRITICAL EXTRACTION RULES:

RULE 1 — Extract ALL rows:
Do not skip any row. Count the rows in the table and make sure your output has the same count. This document has 21 test rows.

RULE 2 — Multi-line requirement cells:
Many cells in the Requirement column contain multiple lines stacked vertically. Each line may be a different compound with its own threshold.
Example of what row 1 looks like in the document:
  Line 1: Phenol: Pass < 30 mg/kg
  Line 2: 2,6-Dimethylphenol / p-Phenylphenol / Tribromphenol: Pass < 50 mg/kg
  Line 3: NP / OP: Pass < 30 mg/kg
Capture ALL lines. Join them using a pipe separator |
Never drop any line from a multi-line cell.

RULE 3 — Method codes in test names:
Some test names have the standard method embedded in parentheses like:
  "Hardness (Method: SATRA TM 205)"
  "Ross Flexing (Method: SATRA TM 60) Room Temperature"
  "Sole Abrasion (Method: SATRA TM 174)"
Extract the full test name as-is into test_name.
Also extract just the method code separately into standard_method.
Example: test_name = "Sole Abrasion (Method: SATRA TM 174)", standard_method = "SATRA TM 174"

RULE 4 — Exact values:
Never round, summarize, or paraphrase any requirement text.
Capture numeric values exactly with their units: mg/kg, mm³, N/mm, etc.
Capture all comparison operators exactly: <, >, ≤, ≥, =

RULE 5 — Age-based requirements:
Some requirements have different thresholds based on product age like:
  "< 36 months (Pass: <100 mg/kg)"
  "> 36 months (Pass: <500 mg/kg)"
Capture both lines completely joined with |

RULE 6 — Condition-based requirements:
Some requirements specify test conditions like:
  "Condition: 70°C / 95% RH / 168 hrs | Requirement: No Blooming"
Capture the condition AND the requirement both.

RULE 7 — Color column:
If the Color cell contains a dash (-), is blank, or says N/A — return null.`,

          schema: {
            type: 'object',
            properties: {
              component: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Component name from the Component Name column of the first small table. Example: EVA Material, PU Sole, Upper Leather'
                  },
                  material_type: {
                    type: 'string',
                    description: 'Material type from the Material Type column. Example: EVA, PU, TPR, Rubber, Synthetic, Leather, Textile'
                  },
                  color: {
                    type: 'string',
                    description: 'Color from the Color column. Return null if blank, dash, or N/A'
                  }
                }
              },
              tests: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    serial_number: {
                      type: 'integer',
                      description: 'The S.No column value. Row number starting from 1. This document has rows 1 through 21.'
                    },
                    test_name: {
                      type: 'string',
                      description: 'Complete test name exactly as written in the Test Name column. Include everything: chemical names, abbreviations in brackets, method references, conditions like Room Temperature. Examples: Phenols – Others, 2-Mercaptobenzothiazole (2-MBT), Ross Flexing (Method: SATRA TM 60) Room Temperature, Polycyclic Aromatic Hydrocarbons (PAH), Global Migration (Skin Contact only)'
                    },
                    standard_method: {
                      type: 'string',
                      description: 'The testing standard or method code if mentioned anywhere in the test name or requirement text. Extract just the code, not the word Method or brackets. Examples: SATRA TM 174, SATRA TM 60, SATRA TM 205, SATRA TM 344, SATRA TM 144, SATRA TM 223, ISO 19574:2022, IS 16258. Return null if no standard or method is mentioned anywhere for this row.'
                    },
                    client_requirement: {
                      type: 'string',
                      description: 'The COMPLETE requirement text from the Requirement column. This is the most important field in the entire extraction. For single-line cells: capture the line exactly. For multi-line cells: capture every single line joined with pipe | Exact examples from this document: Row 1: Phenol: Pass < 30 mg/kg | 2,6-Dimethylphenol / p-Phenylphenol / Tribromphenol: Pass < 50 mg/kg | NP / OP: Pass < 30 mg/kg, Row 4: TBT, TPhT, TBTO: Pass <1 mg/kg; Fail ≥1 mg/kg | OTHERS: Pass <5 mg/kg; Fail ≥5 mg/kg, Row 6: REACh PAH: Pass < 0.5 mg/kg | Napthalene: Pass < 10 mg/kg, Row 10: PCP: Pass < 1.0 mg/kg & Others (For each Isomer): Pass <2.0 mg/kg, Row 12: < 36 months (Pass: <100 mg/kg) | > 36 months (Pass: <500 mg/kg), Row 18: Condition: 70°C / 95% RH / 168 hrs | Requirement: No Blooming, Row 19: < 200 g/mm³, Row 20: Clay Tile: Dry 0.4 & Wet 0.3, Row 21: No soling marks after cleaning by mild circular rubbing. Never shorten, never paraphrase, never drop any part.'
                    },
                    notes: {
                      type: 'string',
                      description: 'Flag any special conditions that need human attention. Add a note if ANY of these apply: Multiple compounds each with a different threshold in the same cell, Age-dependent thresholds (different limits by product age), Both a minimum AND maximum apply (range requirement), Specific test conditions embedded in requirement (temp, humidity, duration), Visual inspection criteria, Surface-specific thresholds (dry vs wet, specific surface type). Return null if none of the above apply to this row.'
                    }
                  }
                }
              }
            }
          }
        },
        settings: {
          array_extract: true
        },
        parsing: {
          enhance: {
            agentic: [
              {
                scope: 'table'
              }
            ]
          },
          formatting: {
            table_output_format: 'html'
          },
          retrieval: {
            filter_blocks: ['Header', 'Footer', 'Page Number']
          },
          settings: {
            persist_results: true
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Reducto extract failed: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Reducto extraction successful:', data.job_id);
    return data;
  } catch (error) {
    console.error('Reducto extraction error:', error);
    throw error;
  }
};

/**
 * Classify test category based on test name keywords
 * @param {string} testName - The test name to classify
 * @returns {string} - Category: 'Raw Material', 'Finished Good', or 'Work In Progress'
 */
const classifyTestCategory = (testName) => {
  const testNameLower = testName.toLowerCase();
  
  // Raw Material keywords
  const rawMaterialKeywords = [
    'phenol', 'lead', 'cadmium', 'arsenic', 'organotin', 'phthalate', 'pah',
    'polycyclic', 'flame retard', 'sccp', 'mccp', 'dmfu', 'dimethylfumarate',
    'chlorinated', 'mercaptobenzothiazole', 'mbt', 'formamide', 'propanol',
    'acetophenone', 'global migration', 'migration', 'heavy metal',
    'naphthalene', 'napthalene', 'reach'
  ];
  
  // Finished Good keywords
  const finishedGoodKeywords = [
    'sole abrasion', 'abrasion', 'flexing', 'hardness', 'slip resistance',
    'slip', 'blooming', 'non-marking', 'non marking', 'bond strength',
    'tensile', 'whole shoe', 'shoe flex', 'ross flex'
  ];
  
  // Check Raw Material first
  for (const keyword of rawMaterialKeywords) {
    if (testNameLower.includes(keyword)) {
      return 'Raw Material';
    }
  }
  
  // Check Finished Good
  for (const keyword of finishedGoodKeywords) {
    if (testNameLower.includes(keyword)) {
      return 'Finished Good';
    }
  }
  
  // Default to Work In Progress
  return 'Work In Progress';
};

/**
 * Determine execution type and inhouse test ID
 * @param {string} standardMethod - The standard method code
 * @param {string} testName - The test name
 * @returns {Object} - {execution_type, inhouse_test_id}
 */
const determineExecutionType = (standardMethod, testName) => {
  const testNameLower = testName.toLowerCase();
  
  // Check standard_method first
  if (standardMethod) {
    const methodMap = {
      'SATRA TM 174': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-174' },
      'SATRA TM 92': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-92' },
      'SATRA TM 161': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-161' },
      'SATRA TM 281': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-281' },
      'SATRA TM 31': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-31' },
      'ISO 19574': { execution_type: 'inhouse', inhouse_test_id: 'ISO-19574' },
      'ISO 19574:2022': { execution_type: 'inhouse', inhouse_test_id: 'ISO-19574' }
    };
    
    if (methodMap[standardMethod]) {
      return methodMap[standardMethod];
    }
  }
  
  // Check test_name keywords
  const keywordMap = {
    'sole abrasion': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-174' },
    'sole flexing': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-92' },
    'whole shoe flexing': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-161' },
    'shoe flexing': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-161' },
    'bond strength': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-281' },
    'tensile': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-281' },
    'ph value': { execution_type: 'inhouse', inhouse_test_id: 'PH-001' },
    'antifungal': { execution_type: 'inhouse', inhouse_test_id: 'ISO-19574' },
    'freezing': { execution_type: 'inhouse', inhouse_test_id: 'FZ-001' },
    'hot air oven': { execution_type: 'inhouse', inhouse_test_id: 'HAO-001' },
    'material abrasion': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-31' },
    'martindale': { execution_type: 'inhouse', inhouse_test_id: 'SATRA-TM-31' }
  };
  
  for (const [keyword, result] of Object.entries(keywordMap)) {
    if (testNameLower.includes(keyword)) {
      return result;
    }
  }
  
  // Default to outsource
  return { execution_type: 'outsource', inhouse_test_id: null };
};

/**
 * Post-process extracted data to add category, execution_type, and other fields
 * @param {Object} extractedData - Raw data from Reducto
 * @returns {Object} - Processed data with additional fields
 */
const postProcessExtractedData = (extractedData) => {
  const processedTests = extractedData.tests.map(test => {
    const category = classifyTestCategory(test.test_name);
    const executionInfo = determineExecutionType(test.standard_method, test.test_name);
    
    return {
      ...test,
      category,
      execution_type: executionInfo.execution_type,
      inhouse_test_id: executionInfo.inhouse_test_id,
      // Empty fields for admin to fill in Step 4 UI
      vendor_name: '',
      vendor_contact: '',
      vendor_email: '',
      expected_report_date: null,
      assigned_tester_id: null,
      test_deadline: null
    };
  });
  
  // Build extraction_meta summary
  const extraction_meta = {
    total_tests_found: processedTests.length,
    inhouse_count: processedTests.filter(t => t.execution_type === 'inhouse').length,
    outsource_count: processedTests.filter(t => t.execution_type === 'outsource').length,
    raw_material_count: processedTests.filter(t => t.category === 'Raw Material').length,
    wip_count: processedTests.filter(t => t.category === 'Work In Progress').length,
    finished_good_count: processedTests.filter(t => t.category === 'Finished Good').length
  };
  
  return {
    component: extractedData.component,
    tests: processedTests,
    extraction_meta
  };
};

/**
 * Handle URL result type for large documents
 * @param {Object} result - Reducto result object
 * @returns {Promise<Object>} - Extracted data
 */
const handleReductoResult = async (result) => {
  if (result.type === 'url') {
    // Fetch content from URL for large documents
    const response = await fetch(result.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch result from URL: ${response.statusText}`);
    }
    return await response.json();
  } else {
    // Direct result for smaller documents
    return result;
  }
};

/**
 * Complete extraction pipeline: upload, extract, post-process, and save
 * @param {string} filePath - Path to the PDF file
 * @param {string} clientDocumentId - Database ID of the client document
 * @returns {Promise<Object>} - Final processed data
 */
const processSpecSheetComplete = async (filePath, clientDocumentId) => {
  try {
    console.log('🚀 Starting complete spec sheet processing pipeline...');
    
    // Step 1: Upload to Reducto
    console.log('📤 Step 1: Uploading to Reducto...');
    const fileId = await uploadToReducto(filePath);
    
    // Step 2: Extract with Reducto
    console.log('🔍 Step 2: Extracting data from spec sheet...');
    const extractionResponse = await extractFromSpecSheet(fileId);
    
    // Step 3: Handle result (URL vs direct)
    console.log('📋 Step 3: Processing extraction result...');
    const rawResult = await handleReductoResult(extractionResponse.result);
    
    // Access result[0] as per Reducto docs
    const extractedData = Array.isArray(rawResult) ? rawResult[0] : rawResult;
    
    // Step 4: Post-process data
    console.log('⚙️ Step 4: Post-processing extracted data...');
    const processedData = postProcessExtractedData(extractedData);
    
    // Step 5: Save to database
    console.log('💾 Step 5: Saving to database...');
    await db.query(
      `UPDATE client_documents SET 
       reducto_file_id = $1, 
       reducto_job_id = $2, 
       extracted_data = $3, 
       extraction_status = 'completed'
       WHERE id = $4`,
      [fileId, extractionResponse.job_id, JSON.stringify(processedData), clientDocumentId]
    );
    
    console.log('✅ Complete spec sheet processing pipeline finished successfully!');
    console.log(`📊 Extraction Summary:
    - Total tests: ${processedData.extraction_meta.total_tests_found}
    - Inhouse: ${processedData.extraction_meta.inhouse_count}
    - Outsource: ${processedData.extraction_meta.outsource_count}
    - Raw Material: ${processedData.extraction_meta.raw_material_count}
    - Finished Good: ${processedData.extraction_meta.finished_good_count}
    - Work In Progress: ${processedData.extraction_meta.wip_count}`);
    
    return processedData;
    
  } catch (error) {
    console.error('❌ Complete spec sheet processing failed:', error);
    
    // Update database with failed status
    try {
      await db.query(
        `UPDATE client_documents SET extraction_status = 'failed' WHERE id = $1`,
        [clientDocumentId]
      );
    } catch (dbError) {
      console.error('Failed to update database with error status:', dbError);
    }
    
    throw error;
  }
};

module.exports = {
  uploadToReducto,
  extractFromSpecSheet,
  processSpecSheetComplete,
  classifyTestCategory,
  determineExecutionType,
  postProcessExtractedData
};
