const dbAdapter = require('../config/dbAdapter');

const DEFAULT_TESTER_EMAIL = (process.env.DEFAULT_TESTER_EMAIL || 'Testing@virola.com').trim();
const DEFAULT_TESTER_NAME = (process.env.DEFAULT_TESTER_NAME || 'Alok').trim();

let cachedDefaultTesterId = null;

/** In-house and combined tests can have a tester assigned. */
function shouldAssignDefaultTester(executionType) {
  const t = String(executionType || '').toLowerCase();
  return t === 'inhouse' || t === 'both';
}

/** Read explicit assignment from payload; undefined means "apply default". */
function getExplicitTesterId(test) {
  if (Object.prototype.hasOwnProperty.call(test, 'assignedTesterId')) {
    return test.assignedTesterId;
  }
  if (Object.prototype.hasOwnProperty.call(test, 'assigned_tester_id')) {
    return test.assigned_tester_id;
  }
  return undefined;
}

/**
 * Resolve tester for create/update payloads.
 * Explicit id wins; null/empty on in-house tests falls back to default (Alok).
 */
function resolveAssignedTester(explicitTesterId, defaultTesterId, executionType) {
  if (explicitTesterId !== undefined && explicitTesterId !== null && explicitTesterId !== '') {
    return Number(explicitTesterId);
  }
  if (shouldAssignDefaultTester(executionType) && defaultTesterId != null) {
    return defaultTesterId;
  }
  return null;
}

/** assigned_at, assigned_by, and status for a new article_tests row */
function assignmentMeta(testerId, assignedBy = 1) {
  const has = testerId != null && testerId !== '';
  return {
    assigned_tester_id: has ? testerId : null,
    assigned_at: has ? new Date() : null,
    assigned_by: has ? assignedBy : null,
    status: has ? 'assigned' : 'pending'
  };
}

async function getDefaultTesterId(client = null) {
  if (cachedDefaultTesterId) return cachedDefaultTesterId;

  const sql = `SELECT id FROM users
    WHERE role = 'tester' AND is_active = true
      AND (
        ($1 <> '' AND LOWER(name) LIKE '%' || LOWER($1) || '%')
        OR ($2 <> '' AND LOWER(email) = LOWER($2))
      )
    ORDER BY CASE
      WHEN $1 <> '' AND LOWER(name) LIKE '%' || LOWER($1) || '%' THEN 0
      ELSE 1
    END
    LIMIT 1`;

  const params = [DEFAULT_TESTER_NAME, DEFAULT_TESTER_EMAIL];

  if (client) {
    const result = await client.query(sql, params);
    cachedDefaultTesterId = result.rows[0]?.id ?? null;
  } else {
    const rows = await dbAdapter.query(sql, params);
    cachedDefaultTesterId = rows[0]?.id ?? null;
  }

  return cachedDefaultTesterId;
}

module.exports = {
  DEFAULT_TESTER_EMAIL,
  DEFAULT_TESTER_NAME,
  getDefaultTesterId,
  getExplicitTesterId,
  shouldAssignDefaultTester,
  resolveAssignedTester,
  assignmentMeta
};
