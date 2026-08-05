const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { fullExtractionPipeline, getExtractionStatus, retryExtraction } = require('../services/extractionPipeline');
const dbAdapter = require('../config/dbAdapter');

/**
 * POST /api/extraction/start
 * Start extraction pipeline for uploaded document
 */
router.post('/start', async (req, res) => {
  try {
    const { clientDocumentId, filePath } = req.body;

    if (!clientDocumentId || !filePath) {
      return res.status(400).json({
        success: false,
        error: 'clientDocumentId and filePath are required'
      });
    }

    // Verify document exists
    const document = await dbAdapter.query(
      'SELECT id, file_name, extraction_status FROM client_documents WHERE id = $1',
      [clientDocumentId]
    );

    if (document.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // Check if extraction is already in progress
    if (document[0].extraction_status === 'processing') {
      return res.status(409).json({
        success: false,
        error: 'Extraction already in progress for this document'
      });
    }

    // Resolve absolute disk path if client sent a public /uploads URL
    let resolvedPath = filePath;
    if (typeof filePath === 'string' && !path.isAbsolute(filePath)) {
      const uploadsRoot = path.join(__dirname, '../uploads');
      const relative = filePath.replace(/^\/?uploads\//i, '');
      const candidate = path.join(uploadsRoot, relative);
      if (fs.existsSync(candidate)) {
        resolvedPath = candidate;
      }
    }

    // Also try looking up stored file_url from DB
    if (!path.isAbsolute(resolvedPath) || !fs.existsSync(resolvedPath)) {
      const withUrl = await dbAdapter.query(
        'SELECT file_url FROM client_documents WHERE id = $1',
        [clientDocumentId]
      );
      if (withUrl[0]?.file_url) {
        const stored = withUrl[0].file_url;
        if (path.isAbsolute(stored) && fs.existsSync(stored)) {
          resolvedPath = stored;
        } else {
          const relative = String(stored).replace(/\\/g, '/').replace(/^\/?uploads\//i, '');
          const candidate = path.join(__dirname, '../uploads', relative);
          if (fs.existsSync(candidate)) resolvedPath = candidate;
          else {
            const byName = path.join(__dirname, '../uploads/documents', path.basename(stored));
            if (fs.existsSync(byName)) resolvedPath = byName;
          }
        }
      }
    }

    // Run extraction pipeline (async for large files)
    const result = await fullExtractionPipeline(resolvedPath, clientDocumentId);

    if (result.success) {
      return res.json({
        success: true,
        data: result.data,
        message: result.message
      });
    }

    return res.status(500).json({
      success: false,
      error: result.error,
      message: result.message
    });

  } catch (error) {
    console.error('Extraction start error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to start extraction'
    });
  }
});

/**
 * GET /api/extraction/status/:clientDocumentId
 * Get extraction status for a document
 */
router.get('/status/:clientDocumentId', async (req, res) => {
  try {
    const { clientDocumentId } = req.params;

    const result = await getExtractionStatus(clientDocumentId);

    if (result.success) {
      return res.json({
        success: true,
        status: result.status,
        data: result.data,
        job_id: result.job_id,
        file_id: result.file_id
      });
    }

    return res.status(404).json({
      success: false,
      error: result.error
    });

  } catch (error) {
    console.error('Get extraction status error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/extraction/retry/:clientDocumentId
 * Retry failed extraction
 */
router.post('/retry/:clientDocumentId', async (req, res) => {
  try {
    const { clientDocumentId } = req.params;
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: 'filePath is required for retry'
      });
    }

    // Verify document exists and is in failed state
    const document = await dbAdapter.query(
      'SELECT id, extraction_status FROM client_documents WHERE id = $1',
      [clientDocumentId]
    );

    if (document.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    if (document[0].extraction_status !== 'failed') {
      return res.status(400).json({
        success: false,
        error: 'Can only retry failed extractions'
      });
    }

    const result = await retryExtraction(clientDocumentId, filePath);

    if (result.success) {
      return res.json({
        success: true,
        data: result.data,
        message: result.message
      });
    }

    return res.status(500).json({
      success: false,
      error: result.error,
      message: result.message
    });

  } catch (error) {
    console.error('Extraction retry error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/extraction/health
 * Health check for extraction service
 */
router.get('/health', async (req, res) => {
  try {
    // Check if Reducto API key is configured
    const hasApiKey = !!process.env.REDUCTO_API_KEY;
    
    res.json({
      success: true,
      status: 'healthy',
      reducto_configured: hasApiKey,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Service unhealthy'
    });
  }
});

module.exports = router;
