const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const sourcePool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 5432),
  ssl: { rejectUnauthorized: false },
});

const targetPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function tableExists(client, tableName) {
  const res = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [tableName]
  );
  return res.rowCount > 0;
}

async function getColumns(client, tableName) {
  const result = await client.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return result.rows;
}

function parseJsonLoose(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;

  try {
    let parsed = JSON.parse(value);
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return fallback;
      }
    }
    if (parsed && typeof parsed === 'object') return parsed;
    return fallback;
  } catch {
    // Try de-escaped quoted JSON text.
    try {
      const unescaped = value
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .trim();
      let reparsed = JSON.parse(unescaped);
      if (typeof reparsed === 'string') {
        reparsed = JSON.parse(reparsed);
      }
      if (reparsed && typeof reparsed === 'object') return reparsed;
      return fallback;
    } catch {
      return fallback;
    }
  }
}

async function salvageTests(src, dst) {
  if (!(await tableExists(src, 'tests')) || !(await tableExists(dst, 'tests'))) {
    console.log('Skipping tests salvage (table missing on source or target)');
    return;
  }

  const sourceRows = await src.query('SELECT * FROM tests');
  const targetCols = await getColumns(dst, 'tests');
  const targetColNames = targetCols.map((c) => c.column_name);
  const jsonCols = new Set(
    targetCols.filter((c) => c.data_type === 'json' || c.data_type === 'jsonb').map((c) => c.column_name)
  );

  await dst.query('DELETE FROM tests');
  let inserted = 0;
  let skipped = 0;

  for (const row of sourceRows.rows) {
    const payload = {};
    for (const col of targetColNames) {
      let val = row[col];

      if (jsonCols.has(col)) {
        const isArrayExpected = col === 'key_tags' || col === 'calculation_steps';
        const fallback = isArrayExpected ? [] : {};
        val = parseJsonLoose(val, fallback);
      }

      payload[col] = val;
    }

    const cols = Object.keys(payload);
    const values = cols.map((c) => payload[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO tests (${cols.map(quoteIdent).join(', ')}) VALUES (${placeholders})`;

    try {
      await dst.query(sql, values);
      inserted += 1;
    } catch (error) {
      const nullJsonPayload = { ...payload };
      for (const col of jsonCols) {
        if (Object.prototype.hasOwnProperty.call(nullJsonPayload, col)) {
          nullJsonPayload[col] = null;
        }
      }

      const fallbackCols = Object.keys(nullJsonPayload);
      const fallbackValues = fallbackCols.map((c) => nullJsonPayload[c]);
      const fallbackPlaceholders = fallbackCols.map((_, i) => `$${i + 1}`).join(', ');
      const fallbackSql = `INSERT INTO tests (${fallbackCols.map(quoteIdent).join(', ')}) VALUES (${fallbackPlaceholders})`;

      try {
        await dst.query(fallbackSql, fallbackValues);
        inserted += 1;
      } catch (fallbackError) {
        skipped += 1;
        console.warn(`Skipped tests row id=${row.id}: ${fallbackError.message}`);
      }
    }
  }

  console.log(`tests salvage done: inserted=${inserted}, skipped=${skipped}`);
}

async function ensureLegacyClient(dst) {
  const code = 'LEGACY-DOCS';
  const check = await dst.query('SELECT id FROM clients WHERE client_code = $1 LIMIT 1', [code]);
  if (check.rowCount > 0) return check.rows[0].id;

  const created = await dst.query(
    `INSERT INTO clients (company_name, client_code, industry, country, address, status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     RETURNING id`,
    ['Legacy Documents Holder', code, 'Legacy', 'Unknown', 'Auto-created for migration fallback']
  );
  return created.rows[0].id;
}

async function salvageClientDocuments(src, dst) {
  if (!(await tableExists(src, 'client_documents')) || !(await tableExists(dst, 'client_documents'))) {
    console.log('Skipping client_documents salvage (table missing on source or target)');
    return;
  }

  const rows = await src.query('SELECT * FROM client_documents');
  const targetColsMeta = await getColumns(dst, 'client_documents');
  const targetCols = targetColsMeta.map((c) => c.column_name);
  const requiredClient = targetCols.includes('client_id');
  const fallbackClientId = requiredClient ? await ensureLegacyClient(dst) : null;

  await dst.query('DELETE FROM client_documents');
  let inserted = 0;
  let skipped = 0;

  for (const row of rows.rows) {
    const payload = {};
    for (const col of targetCols) payload[col] = row[col];

    if (requiredClient && !payload.client_id) {
      payload.client_id = fallbackClientId;
    }

    if (!payload.file_name) payload.file_name = `legacy_document_${String(payload.id || Date.now())}`;
    if (!payload.file_url) {
      skipped += 1;
      continue;
    }

    const cols = Object.keys(payload);
    const vals = cols.map((c) => payload[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO client_documents (${cols.map(quoteIdent).join(', ')}) VALUES (${placeholders})`;

    try {
      await dst.query(sql, vals);
      inserted += 1;
    } catch (error) {
      skipped += 1;
      console.warn(`Skipped client_documents row id=${row.id}: ${error.message}`);
    }
  }

  console.log(`client_documents salvage done: inserted=${inserted}, skipped=${skipped}`);
}

async function main() {
  const src = await sourcePool.connect();
  const dst = await targetPool.connect();
  try {
    await src.query('SELECT NOW()');
    await dst.query('SELECT NOW()');
    console.log('Connected to source and target');

    await salvageTests(src, dst);
    await salvageClientDocuments(src, dst);
  } catch (error) {
    console.error('Salvage failed:', error);
    process.exitCode = 1;
  } finally {
    src.release();
    dst.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

main();
