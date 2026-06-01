const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { exportDashboardData } = require('../services/dashboardExportService');

const router = express.Router();

router.get('/export', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { clientId, testId, dateRange, search } = req.query;

    const result = await exportDashboardData({
      clientId: clientId ? String(clientId) : '',
      testId: testId ? String(testId) : '',
      dateRange: dateRange ? String(dateRange) : 'month',
      search: search ? String(search) : '',
    });

    const contentType =
      result.type === 'zip'
        ? 'application/zip'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (error) {
    console.error('Dashboard export error:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || 'Failed to export dashboard data' });
  }
});

module.exports = router;
