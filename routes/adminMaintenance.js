const express = require('express');
const dbAdapter = require('../config/dbAdapter');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
  createFullBackup,
  createJsonBackup,
  listBackups,
  getBackupFile,
} = require('../services/backupService');

const router = express.Router();

router.post('/backup', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const backup = await createFullBackup({
      generatedBy: req.user?.email || 'admin',
    });

    res.json({
      message: 'Full backup created successfully',
      backup: {
        filename: backup.filename,
        downloadPath: `/api/admin/maintenance/backups/${backup.filename}`,
        sizeBytes: backup.sizeBytes,
        type: 'full',
        manifest: backup.manifest,
      },
    });
  } catch (error) {
    console.error('Full backup error:', error);
    res.status(500).json({ error: 'Failed to create full backup' });
  }
});

router.get('/backups', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const backups = await listBackups();
    res.json({ backups });
  } catch (error) {
    console.error('List backups error:', error);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

router.get('/backups/:filename', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { absolutePath, filename, sizeBytes } = await getBackupFile(req.params.filename);
    const contentType = filename.endsWith('.zip')
      ? 'application/zip'
      : 'application/json';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', sizeBytes);
    res.sendFile(absolutePath);
  } catch (error) {
    console.error('Download backup error:', error);
    const status = error.message === 'Backup file not found' ? 404 : 400;
    res.status(status).json({ error: error.message || 'Failed to download backup' });
  }
});

router.post('/backup-and-reports', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const backup = await createFullBackup({
      generatedBy: req.user?.email || 'admin',
    });

    const reports = await dbAdapter.query(
      `SELECT id, report_number
       FROM article_tests
       WHERE report_generated = true
         AND report_url IS NOT NULL
       ORDER BY id DESC`
    );

    res.json({
      message: 'Full backup completed — includes database, reports, uploads, and templates',
      backupDownloadPath: `/api/admin/maintenance/backups/${backup.filename}`,
      backupFilename: backup.filename,
      backupSizeBytes: backup.sizeBytes,
      backupType: 'full',
      manifest: backup.manifest,
      totalReports: reports.length,
      reportDownloadPaths: reports.map((report) => ({
        testId: report.id,
        reportNumber: report.report_number || `report-${report.id}`,
        downloadPath: `/api/article-tests/${report.id}/download-report`,
      })),
    });
  } catch (error) {
    console.error('Backup and reports operation error:', error);
    res.status(500).json({ error: 'Failed to complete backup' });
  }
});

router.post('/backup-database', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const backup = await createJsonBackup({
      generatedBy: req.user?.email || 'admin',
    });

    res.json({
      message: 'Database-only backup created',
      backup: {
        filename: backup.filename,
        downloadPath: `/api/admin/maintenance/backups/${backup.filename}`,
        sizeBytes: backup.sizeBytes,
        type: 'database-only',
        tableCount: backup.tableCount,
      },
    });
  } catch (error) {
    console.error('Database backup error:', error);
    res.status(500).json({ error: 'Failed to create database backup' });
  }
});

module.exports = router;
