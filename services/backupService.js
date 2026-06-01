const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const archiver = require('archiver');
const dbAdapter = require('../config/dbAdapter');

const BACKUP_VERSION = '1.0';
const BACKUPS_DIR = path.join(__dirname, '..', 'backups');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const FRONTEND_PUBLIC_DIR = path.join(__dirname, '..', '..', 'frontend', 'public');
const REPORT_TEMPLATES_DIR = path.join(__dirname, '..', 'report-templates');

const ensureBackupsDir = async () => {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  return BACKUPS_DIR;
};

const buildDatabaseSnapshot = async () => {
  const rows = await dbAdapter.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const snapshot = {};
  for (const row of rows) {
    const tableName = row.table_name;
    const safeName = String(tableName).replace(/"/g, '""');
    snapshot[tableName] = await dbAdapter.query(`SELECT * FROM "${safeName}"`);
  }

  return snapshot;
};

const countFilesRecursive = async (dirPath) => {
  let count = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        count += await countFilesRecursive(fullPath);
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  } catch {
    // Directory may not exist
  }
  return count;
};

const addDirectoryToArchive = (archive, sourceDir, archivePath) => {
  if (fsSync.existsSync(sourceDir)) {
    archive.directory(sourceDir, archivePath);
  }
};

const createTimestamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const createFullBackup = async ({ generatedBy = 'admin' } = {}) => {
  await ensureBackupsDir();
  const timestamp = createTimestamp();
  const zipFilename = `virola-backup-${timestamp}.zip`;
  const zipAbsolutePath = path.join(BACKUPS_DIR, zipFilename);

  const snapshot = await buildDatabaseSnapshot();
  const tableNames = Object.keys(snapshot);
  const rowCounts = Object.fromEntries(
    tableNames.map((name) => [name, snapshot[name].length])
  );

  const uploadsFileCount = await countFilesRecursive(UPLOADS_DIR);
  const reportsFileCount = await countFilesRecursive(REPORTS_DIR);
  const templatesFileCount = await countFilesRecursive(FRONTEND_PUBLIC_DIR);
  const backendTemplatesFileCount = await countFilesRecursive(REPORT_TEMPLATES_DIR);

  const manifest = {
    backupVersion: BACKUP_VERSION,
    generatedAt: new Date().toISOString(),
    generatedBy,
    contents: {
      database: {
        tables: tableNames.length,
        rowCounts,
      },
      files: {
        uploads: uploadsFileCount,
        reports: reportsFileCount,
        frontendTemplates: templatesFileCount,
        backendTemplates: backendTemplatesFileCount,
      },
    },
    restoreNotes: [
      'Extract the ZIP and restore database.json using the admin restore endpoint or manual import.',
      'Copy files/uploads, files/reports, and files/templates back to their original locations.',
    ],
  };

  const databasePayload = {
    generatedAt: manifest.generatedAt,
    generatedBy,
    tables: snapshot,
  };

  await new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(zipAbsolutePath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);
    output.on('error', reject);

    archive.pipe(output);

    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.append(JSON.stringify(databasePayload, null, 2), { name: 'database.json' });

    addDirectoryToArchive(archive, UPLOADS_DIR, 'files/uploads');
    addDirectoryToArchive(archive, REPORTS_DIR, 'files/reports');
    addDirectoryToArchive(archive, FRONTEND_PUBLIC_DIR, 'files/templates/frontend-public');
    addDirectoryToArchive(archive, REPORT_TEMPLATES_DIR, 'files/templates/backend');

    archive.finalize();
  });

  const stat = await fs.stat(zipAbsolutePath);

  return {
    filename: zipFilename,
    absolutePath: zipAbsolutePath,
    sizeBytes: stat.size,
    manifest,
  };
};

const createJsonBackup = async ({ generatedBy = 'admin' } = {}) => {
  await ensureBackupsDir();
  const timestamp = createTimestamp();
  const backupFilename = `backup-${timestamp}.json`;
  const backupAbsolutePath = path.join(BACKUPS_DIR, backupFilename);

  const snapshot = await buildDatabaseSnapshot();
  const backupPayload = {
    generatedAt: new Date().toISOString(),
    generatedBy,
    tables: snapshot,
  };

  await fs.writeFile(backupAbsolutePath, JSON.stringify(backupPayload, null, 2), 'utf8');
  const stat = await fs.stat(backupAbsolutePath);

  return {
    filename: backupFilename,
    absolutePath: backupAbsolutePath,
    sizeBytes: stat.size,
    tableCount: Object.keys(snapshot).length,
  };
};

const listBackups = async () => {
  await ensureBackupsDir();
  const entries = await fs.readdir(BACKUPS_DIR, { withFileTypes: true });
  const backups = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/^(virola-backup-.*\.zip|backup-.*\.json)$/i.test(entry.name)) continue;

    const fullPath = path.join(BACKUPS_DIR, entry.name);
    const stat = await fs.stat(fullPath);
    backups.push({
      filename: entry.name,
      type: entry.name.endsWith('.zip') ? 'full' : 'database-only',
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
    });
  }

  backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return backups;
};

const resolveBackupPath = (filename) => {
  const safeName = path.basename(filename);
  if (!/^(virola-backup-[\w-]+\.zip|backup-[\w-]+\.json)$/i.test(safeName)) {
    throw new Error('Invalid backup filename');
  }
  const absolutePath = path.join(BACKUPS_DIR, safeName);
  if (!absolutePath.startsWith(BACKUPS_DIR)) {
    throw new Error('Invalid backup path');
  }
  return absolutePath;
};

const getBackupFile = async (filename) => {
  const absolutePath = resolveBackupPath(filename);
  try {
    await fs.access(absolutePath);
  } catch {
    throw new Error('Backup file not found');
  }
  const stat = await fs.stat(absolutePath);
  return { absolutePath, filename: path.basename(filename), sizeBytes: stat.size };
};

module.exports = {
  BACKUPS_DIR,
  createFullBackup,
  createJsonBackup,
  listBackups,
  getBackupFile,
  buildDatabaseSnapshot,
};
