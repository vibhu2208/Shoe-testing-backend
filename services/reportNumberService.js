const ensureReportTablesSql = `
CREATE TABLE IF NOT EXISTS report_sequence (
  id SERIAL PRIMARY KEY,
  year INTEGER UNIQUE NOT NULL,
  last_sequence_number INTEGER NOT NULL DEFAULT 0
);
`;

async function ensureReportColumns(client) {
  await client.query(`
    ALTER TABLE article_tests
    ADD COLUMN IF NOT EXISTS report_generated BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS report_url TEXT,
    ADD COLUMN IF NOT EXISTS report_generated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS report_number VARCHAR(255)
  `);
}

async function nextReportNumber(client, testName) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const fyStart = yy;
  const fyEnd = String((Number(yy) + 1) % 100).padStart(2, '0');
  const yearKey = now.getFullYear();

  await client.query(ensureReportTablesSql);

  const existingRow = await client.query(
    `SELECT id, last_sequence_number
     FROM report_sequence
     WHERE year = $1
     ORDER BY id ASC
     LIMIT 1
     FOR UPDATE`,
    [yearKey]
  );

  let rowId;
  if (existingRow.rows.length === 0) {
    const inserted = await client.query(
      `INSERT INTO report_sequence (year, last_sequence_number)
       VALUES ($1, 0)
       RETURNING id`,
      [yearKey]
    );
    rowId = inserted.rows[0].id;
  } else {
    rowId = existingRow.rows[0].id;
  }

  const seqResult = await client.query(
    `UPDATE report_sequence
     SET last_sequence_number = last_sequence_number + 1
     WHERE id = $1
     RETURNING last_sequence_number`,
    [rowId]
  );
  const seq = Number(seqResult.rows[0].last_sequence_number);
  return `${seq}-${fyStart}-${fyEnd} ${String(testName || '').toUpperCase()}`;
}

module.exports = {
  ensureReportColumns,
  nextReportNumber
};
