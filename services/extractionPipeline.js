const { processSpecSheetComplete } = require('./extractionService');
const dbAdapter = require('../config/dbAdapter');

/**
 * Full extraction pipeline: upload → extract → classify → save
 * @param {string} filePath - Path to the uploaded file
 * @param {string} clientDocumentId - Database ID of the client document record
 * @param {Object} db - Database adapter instance
 * @returns {Promise<Object>} - Pipeline result with success/error status
 */
const fullExtractionPipeline = async (filePath, clientDocumentId, db = dbAdapter) => {
  try {
    console.log(`Starting extraction pipeline for document ${clientDocumentId}`);
    
    // Use the new complete pipeline that handles everything
    const result = await processSpecSheetComplete(filePath, clientDocumentId);
    
    return {
      success: true,
      data: result,
      message: `Successfully extracted ${result.extraction_meta.total_tests_found} tests from document`
    };

  } catch (error) {
    console.error('Extraction pipeline error:', error);
    
    return {
      success: false,
      error: error.message,
      message: 'Extraction pipeline failed'
    };
  }
};

/**
 * Get extraction status for a document
 * @param {string} clientDocumentId - Database ID of the client document
 * @param {Object} db - Database adapter instance
 * @returns {Promise<Object>} - Status and data
 */
const getExtractionStatus = async (clientDocumentId, db = dbAdapter) => {
  try {
    const result = await db.query(
      `SELECT extraction_status, extracted_data, reducto_job_id, reducto_file_id
       FROM client_documents
       WHERE id = $1`,
      [clientDocumentId]
    );

    if (result.length === 0) {
      return {
        success: false,
        error: 'Document not found'
      };
    }

    const row = result[0];
    
    return {
      success: true,
      status: row.extraction_status,
      data: row.extracted_data ? JSON.parse(row.extracted_data) : null,
      job_id: row.reducto_job_id,
      file_id: row.reducto_file_id
    };
  } catch (error) {
    console.error('Error getting extraction status:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Retry failed extraction
 * @param {string} clientDocumentId - Database ID of the client document
 * @param {string} filePath - Path to the file to retry
 * @param {Object} db - Database adapter instance
 * @returns {Promise<Object>} - Retry result
 */
const retryExtraction = async (clientDocumentId, filePath, db = dbAdapter) => {
  try {
    // Reset status to pending
    await db.execute(
      `UPDATE client_documents
       SET extraction_status = 'pending',
           reducto_file_id = NULL,
           reducto_job_id = NULL,
           extracted_data = NULL
       WHERE id = $1`,
      [clientDocumentId]
    );

    // Run pipeline again
    return await fullExtractionPipeline(filePath, clientDocumentId, db);
  } catch (error) {
    console.error('Error retrying extraction:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  fullExtractionPipeline,
  getExtractionStatus,
  retryExtraction
};
