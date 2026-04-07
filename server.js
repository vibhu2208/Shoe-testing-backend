const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-frontend-domain.com'] 
    : ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'],
  credentials: true
}));
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
