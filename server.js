const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

// Use PostgreSQL database adapter
const dbAdapter = require('./config/dbAdapter');

// Import routes
const testLibraryRoutes = require('./routes/testLibrary');
const clientRoutes = require('./routes/clients');
const articleRoutes = require('./routes/articles');
const extractionRoutes = require('./routes/extraction');
const documentRoutes = require('./routes/documents');
const testerRoutes = require('./routes/tester');
const periodicRoutes = require('./routes/periodic');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const BUG_REPORT_TO_EMAIL = process.env.BUG_REPORT_TO_EMAIL || 'vaibhav.kaushik@ttsys.in';

// CORS — set CLIENT_ORIGINS on Render (comma-separated), e.g. https://shoe-testing-frontend.vercel.app
const localDevOrigins = [
  'http://localhost:3000',
  'https://shoe-testing-frontend.vercel.app',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];
const extraOrigins = (process.env.CLIENT_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...localDevOrigins, ...extraOrigins])];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn(`CORS blocked: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/reports', express.static(path.join(__dirname, 'reports')));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Virola LIMS Backend Server is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

const buildBugReportTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
};

const bugAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max screenshot
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed for screenshot upload'));
    }
    cb(null, true);
  },
});

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// Authentication routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    const users = await dbAdapter.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    if (users.length === 0) {
      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    const user = users[0];
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    // Auto-detect role from user record or validate if role is provided
    if (role && role !== user.role) {
      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const userResponse = {
      id: user.id.toString(),
      email: user.email,
      name: user.name,
      role: user.role
    };

    res.json({
      message: 'Login successful',
      token,
      user: userResponse
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User profile route
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const users = await dbAdapter.query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    res.json({
      id: user.id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.created_at
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin routes
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const users = await dbAdapter.query(
      'SELECT id, email, role, name, created_at FROM users ORDER BY created_at DESC'
    );

    const formattedUsers = users.map(user => ({
      id: user.id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
      createdAt: user.created_at
    }));

    res.json({ users: formattedUsers });
    
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        error: 'Name, email, password, and role are required'
      });
    }

    // Check if user already exists
    const existingUsers = await dbAdapter.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({
        error: 'User with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const result = await dbAdapter.execute(
      'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
      [name, email, hashedPassword, role]
    );

    const newUser = result.rows[0];

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: newUser.id.toString(),
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        createdAt: newUser.created_at
      }
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/users/:userId', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const { userId } = req.params;

    // Check if user exists and get their role
    const users = await dbAdapter.query(
      'SELECT role FROM users WHERE id = $1',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deletion of admin users
    if (users[0].role === 'admin') {
      return res.status(400).json({
        error: 'Cannot delete admin users'
      });
    }

    // Delete user
    await dbAdapter.execute(
      'DELETE FROM users WHERE id = $1',
      [userId]
    );

    res.json({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/bug-report', bugAttachmentUpload.single('screenshot'), async (req, res) => {
  try {
    const { title, description, priority, reporterEmail, pagePath, userAgent } = req.body || {};

    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }

    const normalizedPriority = String(priority || 'medium').toLowerCase();
    const allowedPriorities = ['low', 'medium', 'high', 'critical'];
    if (!allowedPriorities.includes(normalizedPriority)) {
      return res.status(400).json({ error: 'Invalid priority value' });
    }

    let reporter = null;
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
      try {
        reporter = jwt.verify(token, JWT_SECRET);
      } catch {
        reporter = null;
      }
    }

    const transporter = buildBugReportTransporter();
    if (!transporter) {
      console.error('Bug report failed: SMTP is not configured');
      return res.status(500).json({ error: 'Bug reporting email service is not configured' });
    }

    const submittedAt = new Date().toISOString();
    const finalReporterEmail = reporterEmail || reporter?.email || 'not-provided';
    const finalReporterName = reporter?.name || 'Unknown user';
    const screenshot = req.file || null;
    const screenshotName = screenshot?.originalname || 'none';
    const screenshotSize = screenshot ? `${Math.round((screenshot.size / 1024) * 100) / 100} KB` : 'none';

    const textBody = [
      'New Bug Report',
      `Submitted At: ${submittedAt}`,
      `Priority: ${normalizedPriority}`,
      `Title: ${title}`,
      `Reporter Name: ${finalReporterName}`,
      `Reporter Email: ${finalReporterEmail}`,
      `Reporter Role: ${reporter?.role || 'unknown'}`,
      `Page Path: ${pagePath || 'unknown'}`,
      `IP: ${req.ip || 'unknown'}`,
      `User Agent: ${userAgent || req.headers['user-agent'] || 'unknown'}`,
      `Screenshot: ${screenshotName} (${screenshotSize})`,
      '',
      'Description:',
      String(description),
    ].join('\n');

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;background:#f6f8fb;padding:24px;">
        <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
          <div style="padding:16px 20px;background:#111827;color:#ffffff;">
            <h2 style="margin:0;font-size:18px;">New Bug Report Submitted</h2>
          </div>
          <div style="padding:20px;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:8px;border:1px solid #e5e7eb;width:180px;"><strong>Title</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(title)}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;"><strong>Priority</strong></td><td style="padding:8px;border:1px solid #e5e7eb;text-transform:uppercase;">${escapeHtml(normalizedPriority)}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;"><strong>Submitted At</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(submittedAt)}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;"><strong>Reporter Name</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(finalReporterName)}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;"><strong>Reporter Email</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(finalReporterEmail)}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;"><strong>Reporter Role</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(reporter?.role || 'unknown')}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;"><strong>Page Path</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(pagePath || 'unknown')}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;"><strong>IP Address</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(req.ip || 'unknown')}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;"><strong>User Agent</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(userAgent || req.headers['user-agent'] || 'unknown')}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;"><strong>Screenshot</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(screenshotName)} (${escapeHtml(screenshotSize)})</td></tr>
            </table>
            <h3 style="margin:20px 0 10px;font-size:16px;color:#111827;">Bug Description</h3>
            <div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;white-space:pre-wrap;line-height:1.5;">${escapeHtml(description)}</div>
          </div>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: BUG_REPORT_TO_EMAIL,
      subject: `[Bug Report][${normalizedPriority.toUpperCase()}] ${String(title).slice(0, 120)}`,
      text: textBody,
      html: htmlBody,
      attachments: screenshot ? [{
        filename: screenshot.originalname || 'screenshot.png',
        content: screenshot.buffer,
        contentType: screenshot.mimetype,
      }] : [],
    });

    res.status(201).json({ message: 'Bug report sent successfully' });
  } catch (error) {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Screenshot must be 5MB or smaller' });
      }
      return res.status(400).json({ error: error.message });
    }
    console.error('Bug report error:', error);
    if (error && error.message === 'Only image files are allowed for screenshot upload') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mount test library routes with authentication
app.use('/api/tests', authenticateToken, testLibraryRoutes);

// Mount client management routes with authentication (disabled for development)
if (process.env.NODE_ENV === 'production') {
  app.use('/api/clients', authenticateToken, clientRoutes);
} else {
  app.use('/api/clients', clientRoutes);
  console.log('🔓 Client routes mounted without authentication (development mode)');
}

// Mount extraction routes with authentication (disabled for development)
if (process.env.NODE_ENV === 'production') {
  app.use('/api/extraction', authenticateToken, extractionRoutes);
} else {
  app.use('/api/extraction', extractionRoutes);
  console.log('🔓 Extraction routes mounted without authentication (development mode)');
}

// Mount document routes with authentication (disabled for development)
if (process.env.NODE_ENV === 'production') {
  app.use('/api/documents', authenticateToken, documentRoutes);
} else {
  app.use('/api/documents', documentRoutes);
  console.log('🔓 Document routes mounted without authentication (development mode)');
}

// Mount article routes with authentication (disabled for development)
if (process.env.NODE_ENV === 'production') {
  app.use('/api', authenticateToken, articleRoutes);
} else {
  app.use('/api', articleRoutes);
  console.log('🔓 Article routes mounted without authentication (development mode)');
}

// Mount tester routes with authentication (disabled for development)
if (process.env.NODE_ENV === 'production') {
  app.use('/api/tester', authenticateToken, testerRoutes);
} else {
  app.use('/api/tester', testerRoutes);
  console.log('🔓 Tester routes mounted without authentication (development mode)');
}

// Periodic testing schedules
if (process.env.NODE_ENV === 'production') {
  app.use('/api/periodic', authenticateToken, periodicRoutes);
} else {
  app.use('/api/periodic', periodicRoutes);
  console.log('🔓 Periodic routes mounted without authentication (development mode)');
}

// Initialize database
const initDatabase = async () => {
  try {
    console.log('Initializing PostgreSQL database...');
    
    // Test database connection
    const isConnected = await dbAdapter.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to PostgreSQL database');
    }

    console.log('Database initialization completed successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
  }
};

// Start server
const startServer = async () => {
  try {
    await initDatabase();
    
    app.listen(PORT, () => {
      console.log(`🚀 Virola LIMS Backend Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
