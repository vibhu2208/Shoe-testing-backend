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

const UPLOADS_ROOT = path.join(__dirname, '../uploads');

/** Convert absolute disk paths / backslashes into a public /uploads/... URL. */
function toPublicUploadUrl(storedPath) {
  if (!storedPath || typeof storedPath !== 'string') return null;
  const normalized = storedPath.replace(/\\/g, '/');

  if (normalized.startsWith('/uploads/')) return normalized;
  if (normalized.startsWith('uploads/')) return `/${normalized}`;

  const marker = '/uploads/';
  const idx = normalized.toLowerCase().lastIndexOf(marker);
  if (idx !== -1) {
    return normalized.slice(idx);
  }

  // Bare filename fallback
  const base = path.basename(normalized);
  if (base && base.includes('.')) {
    return `/uploads/documents/${base}`;
  }
  return null;
}

/** Resolve a stored file_url (absolute or /uploads/...) to a local disk path. */
function resolveLocalFilePath(storedPath) {
  if (!storedPath || typeof storedPath !== 'string') return null;

  if (path.isAbsolute(storedPath) && fs.existsSync(storedPath)) {
    return storedPath;
  }

  const publicUrl = toPublicUploadUrl(storedPath);
  if (publicUrl) {
    const relative = publicUrl.replace(/^\/uploads\//i, '');
    const candidate = path.join(UPLOADS_ROOT, relative);
    if (fs.existsSync(candidate)) return candidate;
  }

  // Try basename under documents/
  const byName = path.join(UPLOADS_ROOT, 'documents', path.basename(storedPath));
  if (fs.existsSync(byName)) return byName;

  return null;
}

/** null = standalone upload; string = linked client; { error } = invalid */
const resolveUploadClientId = (clientId) => {
  if (!clientId || clientId === 'null' || clientId === 'undefined') {
    return null;
  }
  if (clientId === 'temp-client-id') {
    return { error: 'A valid clientId (UUID) is required' };
  }
  if (!isValidUuid(clientId)) {
    return { error: 'A valid clientId (UUID) is required' };
  }
  return clientId;
};

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

    const resolvedClientId = resolveUploadClientId(clientId);
    if (resolvedClientId && typeof resolvedClientId === 'object' && resolvedClientId.error) {
      return res.status(400).json({
        success: false,
        error: resolvedClientId.error
      });
    }

    const storedUrl = toPublicUploadUrl(filePath) || filePath;
    
    // Create document record in database
    const result = await dbAdapter.execute(`
      INSERT INTO client_documents (
        client_id, file_name, file_url, file_type, 
        extraction_status, uploaded_at
      ) VALUES ($1, $2, $3, $4, 'pending', NOW()) RETURNING id
    `, [
      resolvedClientId,
      fileName,
      storedUrl,
      mimeType || 'application/pdf'
    ]);

    const documentId = result.rows[0].id;

    res.json({
      success: true,
      documentId: documentId,
      filePath: storedUrl,
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
    const resolvedClientId = resolveUploadClientId(clientId);

    if (resolvedClientId && typeof resolvedClientId === 'object' && resolvedClientId.error) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return res.status(400).json({
        success: false,
        error: resolvedClientId.error
      });
    }
    
    const publicUrl = toPublicUploadUrl(req.file.path) || `/uploads/documents/${req.file.filename}`;

    // Create document record in database
    const result = await dbAdapter.execute(`
      INSERT INTO client_documents (
        client_id, file_name, file_url, file_type, 
        extraction_status, uploaded_at
      ) VALUES ($1, $2, $3, $4, 'pending', NOW()) RETURNING id
    `, [
      resolvedClientId,
      fileName || req.file.originalname,
      publicUrl,
      req.file.mimetype
    ]);

    const documentId = result.rows[0].id;

    res.json({
      success: true,
      documentId: documentId,
      // Absolute path for Reducto extraction; public URL for browser viewing
      filePath: req.file.path,
      fileUrl: publicUrl,
      fileName: fileName || req.file.originalname,
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
 * GET /api/documents/spec-library
 * Browsable catalog of uploaded PDFs / extracted specs
 * Must be registered before /:documentId so "spec-library" is not treated as an id.
 */
router.get('/spec-library', async (req, res) => {
  try {
    const { clientId, search } = req.query;
    let query = `
      SELECT
        d.id, d.client_id, d.file_name, d.file_url, d.file_type,
        d.uploaded_at, d.extracted_data, d.extraction_status,
        c.company_name AS client_name, c.client_code
      FROM client_documents d
      LEFT JOIN clients c ON c.id = d.client_id
      WHERE 1=1
    `;
    const params = [];
    if (clientId) {
      params.push(clientId);
      query += ` AND d.client_id = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (d.file_name ILIKE $${params.length} OR c.company_name ILIKE $${params.length})`;
    }
    query += ' ORDER BY d.uploaded_at DESC LIMIT 200';

    const rows = await dbAdapter.query(query, params);
    res.json({
      documents: rows.map((d) => ({
        id: d.id,
        clientId: d.client_id,
        clientName: d.client_name,
        clientCode: d.client_code,
        fileName: d.file_name,
        fileUrl: toPublicUploadUrl(d.file_url) || d.file_url,
        viewUrl: `/api/documents/${d.id}/file`,
        fileType: d.file_type,
        uploadedAt: d.uploaded_at,
        extractionStatus: d.extraction_status,
        extractedData:
          typeof d.extracted_data === 'string'
            ? JSON.parse(d.extracted_data || 'null')
            : d.extracted_data,
      })),
    });
  } catch (error) {
    console.error('Spec library list error:', error);
    res.status(500).json({ error: 'Failed to load spec library' });
  }
});

/**
 * GET /api/documents/:documentId/file
 * Stream the stored PDF (handles absolute disk paths and /uploads/... URLs).
 */
router.get('/:documentId/file', async (req, res) => {
  try {
    const documents = await dbAdapter.query(
      'SELECT file_name, file_url, file_type FROM client_documents WHERE id = $1',
      [req.params.documentId]
    );

    if (!documents.length) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = documents[0];
    const localPath = resolveLocalFilePath(doc.file_url);
    if (!localPath) {
      return res.status(404).json({
        error: 'File not found on server',
        hint: 'The document record exists but the PDF file is missing from uploads.',
      });
    }

    res.setHeader('Content-Type', doc.file_type || 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${String(doc.file_name || 'document.pdf').replace(/"/g, '')}"`
    );
    fs.createReadStream(localPath).pipe(res);
  } catch (error) {
    console.error('Serve document file error:', error);
    res.status(500).json({ error: 'Failed to open document' });
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
    let extractedData = document.extracted_data;
    if (typeof extractedData === 'string') {
      try {
        extractedData = JSON.parse(extractedData);
      } catch {
        extractedData = null;
      }
    }
    
    res.json({
      success: true,
      document: {
        id: document.id,
        fileName: document.file_name,
        fileSize: document.file_size,
        fileType: document.file_type,
        extractionStatus: document.extraction_status,
        extractedData,
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
    const localPath = resolveLocalFilePath(filePath);
    if (localPath && fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
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
