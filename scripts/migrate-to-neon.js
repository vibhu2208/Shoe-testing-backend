const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const SOURCE_CONFIG = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 5432),
  ssl: { rejectUnauthorized: false },
};

const TARGET_DATABASE_URL = process.env.DATABASE_URL || process.env.NEW_DATABASE_URL;
if (!TARGET_DATABASE_URL) {
  console.error('Missing DATABASE_URL (or NEW_DATABASE_URL) in .env');
  process.exit(1);
}

const sourcePool = new Pool(SOURCE_CONFIG);
const targetPool = new Pool({
  connectionString: TARGET_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

function buildColumnSql(column) {
  const typeName = column.udt_name;
  let typeSql = typeName;
  if (typeName === 'varchar' && column.character_maximum_length) {
    typeSql = `varchar(${column.character_maximum_length})`;
  } else if (typeName === 'bpchar' && column.character_maximum_length) {
    typeSql = `char(${column.character_maximum_length})`;
  } else if (typeName === 'numeric' && column.numeric_precision) {
    typeSql = column.numeric_scale !== null
      ? `numeric(${column.numeric_precision},${column.numeric_scale})`
      : `numeric(${column.numeric_precision})`;
  } else if (typeName === 'timestamptz') {
    typeSql = 'timestamp with time zone';
  } else if (typeName === 'timestamp') {
    typeSql = 'timestamp without time zone';
  }

  const nullSql = column.is_nullable === 'NO' ? 'NOT NULL' : 'NULL';
  const safeDefault = column.column_default && !String(column.column_default).includes('nextval(')
    ? column.column_default
    : null;
  const defaultSql = safeDefault ? `DEFAULT ${safeDefault}` : '';
  return `${quoteIdent(column.column_name)} ${typeSql} ${defaultSql} ${nullSql}`.replace(/\s+/g, ' ').trim();
}

async function getPublicTables(client) {
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return result.rows.map((r) => r.table_name);
}

async function ensureTableExists(targetClient, sourceClient, tableName) {
  const exists = await targetClient.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [tableName]
  );
  if (exists.rowCount > 0) return;

  const cols = await sourceClient.query(
    `SELECT
      column_name, is_nullable, column_default, udt_name,
      character_maximum_length, numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [tableName]
  );
  if (!cols.rowCount) return;

  const colSql = cols.rows.map(buildColumnSql).join(', ');
  await targetClient.query(`CREATE TABLE IF NOT EXISTS ${quoteIdent(tableName)} (${colSql})`);
}

async function getColumns(client, tableName) {
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return result.rows.map((r) => r.column_name);
}

async function getJsonColumns(client, tableName) {
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
       AND data_type IN ('json', 'jsonb')`,
    [tableName]
  );
  return new Set(result.rows.map((r) => r.column_name));
}

function sanitizeJsonValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

async function getInsertOrder(targetClient, tables) {
  const tableSet = new Set(tables);
  const fkResult = await targetClient.query(`
    SELECT
      tc.table_name AS child_table,
      ccu.table_name AS parent_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
  `);

  const parents = new Map();
  const incoming = new Map();
  tables.forEach((t) => {
    parents.set(t, new Set());
    incoming.set(t, 0);
  });

  fkResult.rows.forEach(({ child_table, parent_table }) => {
    if (!tableSet.has(child_table) || !tableSet.has(parent_table)) return;
    if (!parents.get(parent_table).has(child_table)) {
      parents.get(parent_table).add(child_table);
      incoming.set(child_table, incoming.get(child_table) + 1);
    }
  });

  const queue = tables.filter((t) => incoming.get(t) === 0);
  const ordered = [];
  while (queue.length) {
    const t = queue.shift();
    ordered.push(t);
    for (const child of parents.get(t)) {
      incoming.set(child, incoming.get(child) - 1);
      if (incoming.get(child) === 0) queue.push(child);
    }
  }

  if (ordered.length !== tables.length) {
    return tables;
  }
  return ordered;
}

async function copyTableData(sourceClient, targetClient, tableName, columns) {
  if (!columns.length) return 0;
  const colList = columns.map(quoteIdent).join(', ');
  const jsonColumns = await getJsonColumns(targetClient, tableName);
  const srcRows = await sourceClient.query(`SELECT ${colList} FROM ${quoteIdent(tableName)}`);
  if (!srcRows.rowCount) return 0;

  const chunkSize = 500;
  let insertedCount = 0;
  for (let i = 0; i < srcRows.rows.length; i += chunkSize) {
    const chunk = srcRows.rows.slice(i, i + chunkSize);
    const values = [];
    const placeholders = chunk.map((row, rIdx) => {
      const rowPlaceholders = columns.map((col, cIdx) => {
        const rawValue = row[col];
        const safeValue = jsonColumns.has(col) ? sanitizeJsonValue(rawValue) : rawValue;
        values.push(safeValue);
        return `$${rIdx * columns.length + cIdx + 1}`;
      });
      return `(${rowPlaceholders.join(', ')})`;
    });

    const insertSql = `INSERT INTO ${quoteIdent(tableName)} (${colList}) VALUES ${placeholders.join(', ')}`;
    try {
      await targetClient.query(insertSql, values);
      insertedCount += chunk.length;
    } catch (error) {
      // Fallback to row-by-row insert to isolate and recover from bad source rows.
      for (const row of chunk) {
        const rowValues = columns.map((col) => {
          const rawValue = row[col];
          return jsonColumns.has(col) ? sanitizeJsonValue(rawValue) : rawValue;
        });
        const rowPlaceholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
        const rowInsertSql = `INSERT INTO ${quoteIdent(tableName)} (${colList}) VALUES (${rowPlaceholders})`;
        try {
          await targetClient.query(rowInsertSql, rowValues);
          insertedCount += 1;
        } catch (rowError) {
          if (rowError.code === '22P02') {
            const softenedValues = rowValues.map((v) => {
              if (typeof v === 'string' && (v.trim().startsWith('{') || v.trim().startsWith('['))) {
                return null;
              }
              return v;
            });
            try {
              await targetClient.query(rowInsertSql, softenedValues);
              insertedCount += 1;
            } catch (softError) {
              console.warn(`Skipping invalid row in ${tableName}:`, softError.message);
            }
          } else {
            console.warn(`Skipping row in ${tableName}:`, rowError.message);
          }
        }
      }
    }
  }
  return insertedCount;
}

async function syncSequences(targetClient) {
  const seqRows = await targetClient.query(`
    SELECT
      c.table_name,
      c.column_name,
      pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) AS sequence_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_default LIKE 'nextval(%'
  `);

  for (const row of seqRows.rows) {
    if (!row.sequence_name) continue;
    const sql = `
      SELECT setval(
        $1,
        COALESCE((SELECT MAX(${quoteIdent(row.column_name)}) FROM ${quoteIdent(row.table_name)}), 0),
        true
      )
    `;
    await targetClient.query(sql, [row.sequence_name]);
  }
}

async function main() {
  const sourceClient = await sourcePool.connect();
  const targetClient = await targetPool.connect();
  try {
    console.log('Testing source and target database connections...');
    await sourceClient.query('SELECT NOW()');
    await targetClient.query('SELECT NOW()');
    console.log('Connections OK');

    const sourceTables = await getPublicTables(sourceClient);
    if (!sourceTables.length) {
      console.log('No source tables found.');
      return;
    }

    for (const table of sourceTables) {
      await ensureTableExists(targetClient, sourceClient, table);
    }

    const targetTables = await getPublicTables(targetClient);
    const tablesToMove = sourceTables.filter((t) => targetTables.includes(t));
    const ordered = await getInsertOrder(targetClient, tablesToMove);

    if (ordered.length) {
      const truncList = ordered.map(quoteIdent).join(', ');
      await targetClient.query(`TRUNCATE TABLE ${truncList} RESTART IDENTITY CASCADE`);
    }

    const counts = {};
    for (const table of ordered) {
      console.log(`Copying table: ${table}`);
      const sourceCols = await getColumns(sourceClient, table);
      const targetCols = await getColumns(targetClient, table);
      const commonCols = sourceCols.filter((c) => targetCols.includes(c));
      const moved = await copyTableData(sourceClient, targetClient, table, commonCols);
      counts[table] = moved;
      console.log(`Moved ${moved} rows -> ${table}`);
    }

    await syncSequences(targetClient);

    console.log('Migration complete.');
    console.log(counts);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    sourceClient.release();
    targetClient.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

main();
