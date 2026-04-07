const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Admin role verification
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Self or admin access (users can access their own data)
const requireSelfOrAdmin = (req, res, next) => {
  const targetUserId = parseInt(req.params.id || req.params.userId);
  const currentUserId = req.user.userId;
  const isAdmin = req.user.role === 'admin';
  
  if (!isAdmin && currentUserId !== targetUserId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireSelfOrAdmin
};
