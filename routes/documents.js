const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dbAdapter = require('../config/dbAdapter');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/documents');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Only allow PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

const isValidUuid = (value) => (
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
);

/**
 * POST /api/documents/upload
 * Create database record for uploaded document (file already saved by Next.js)
 */
router.post('/upload', async (req, res) => {
  try {
    const { clientId, fileName, filePath, fileSize, mimeType } = req.body;
    
    if (!fileName || !filePath) {
      return res.status(400).json({
        success: false,
        error: 'fileName and filePath are required'
      });
    }

    if (!clientId || clientId === 'temp-client-id' || !isValidUuid(clientId)) {
      return res.status(400).json({
        success: false,
        error: 'A valid clientId (UUID) is required'
      });
    }
    
    // Create document record in database
    const result = await dbAdapter.execute(`
      INSERT INTO client_documents (
        client_id, file_name, file_url, file_type, 
        extraction_status, uploaded_at
      ) VALUES ($1, $2, $3, $4, 'pending', NOW()) RETURNING id
    `, [
      clientId,
      fileName,
      filePath,
      mimeType || 'application/pdf'
    ]);

    const documentId = result.rows[0].id;

    res.json({
      success: true,
      documentId: documentId,
      filePath: filePath,
      fileName: fileName,
      fileSize: fileSize,
      message: 'Document record created successfully'
    });

  } catch (error) {
    console.error('Document upload error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to create document record',
      message: error.message
    });
  }
});

/**
 * POST /api/documents/upload-file
 * Upload a document file directly to backend (alternative endpoint)
 */
router.post('/upload-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const { fileName, clientId } = req.body;

    if (!clientId || clientId === 'temp-client-id' || !isValidUuid(clientId)) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return res.status(400).json({
        success: false,
        error: 'A valid clientId (UUID) is required'
      });
    }
    
    // Create document record in database
    const result = await dbAdapter.execute(`
      INSERT INTO client_documents (
        client_id, file_name, file_url, file_type, 
        extraction_status, uploaded_at
      ) VALUES ($1, $2, $3, $4, 'pending', NOW()) RETURNING id
    `, [
      clientId,
      fileName || req.file.originalname,
      req.file.path,
      req.file.mimetype
    ]);

    const documentId = result.rows[0].id;

    res.json({
      success: true,
      documentId: documentId,
      filePath: req.file.path,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      message: 'Document uploaded successfully'
    });

  } catch (error) {
    console.error('Document upload error:', error);
    
    // Clean up uploaded file if database operation failed
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to upload document',
      message: error.message
    });
  }
});

/**
 * GET /api/documents/:documentId
 * Get document details
 */
router.get('/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;

    const documents = await dbAdapter.query(
      'SELECT * FROM client_documents WHERE id = $1',
      [documentId]
    );

    if (documents.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    const document = documents[0];
    
    res.json({
      success: true,
      document: {
        id: document.id,
        fileName: document.file_name,
        fileSize: document.file_size,
        fileType: document.file_type,
        extractionStatus: document.extraction_status,
        extractedData: document.extracted_data ? JSON.parse(document.extracted_data) : null,
        uploadedAt: document.uploaded_at
      }
    });

  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get document'
    });
  }
});

/**
 * DELETE /api/documents/:documentId
 * Delete document and file
 */
router.delete('/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;

    // Get document details first
    const documents = await dbAdapter.query(
      'SELECT file_url FROM client_documents WHERE id = $1',
      [documentId]
    );

    if (documents.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    const filePath = documents[0].file_url;

    // Delete from database
    await dbAdapter.execute(
      'DELETE FROM client_documents WHERE id = $1',
      [documentId]
    );

    // Delete physical file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });

  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete document'
    });
  }
});

module.exports = router;
