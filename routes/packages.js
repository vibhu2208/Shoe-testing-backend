const express = require('express');
const dbAdapter = require('../config/dbAdapter');
const router = express.Router();

async function ensurePackagesTables() {
  await dbAdapter.execute(`
    CREATE TABLE IF NOT EXISTS test_packages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await dbAdapter.execute(`
    CREATE TABLE IF NOT EXISTS test_package_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      package_id UUID NOT NULL REFERENCES test_packages(id) ON DELETE CASCADE,
      test_id VARCHAR(50) NOT NULL,
      test_name VARCHAR(255),
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

router.use(async (req, res, next) => {
  try {
    await ensurePackagesTables();
    next();
  } catch (error) {
    console.error('Packages table ensure failed:', error);
    res.status(500).json({ error: 'Failed to initialize packages' });
  }
});

router.get('/', async (req, res) => {
  try {
    const packages = await dbAdapter.query(
      `SELECT p.*,
        (SELECT COUNT(*)::int FROM test_package_items i WHERE i.package_id = p.id) AS item_count
       FROM test_packages p
       ORDER BY p.name ASC`
    );
    res.json(packages);
  } catch (error) {
    console.error('Error listing packages:', error);
    res.status(500).json({ error: 'Failed to list packages' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const rows = await dbAdapter.query('SELECT * FROM test_packages WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Package not found' });
    const items = await dbAdapter.query(
      `SELECT * FROM test_package_items WHERE package_id = $1 ORDER BY sort_order, test_name`,
      [req.params.id]
    );
    res.json({ ...rows[0], items });
  } catch (error) {
    console.error('Error fetching package:', error);
    res.status(500).json({ error: 'Failed to fetch package' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, description, items } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Package name is required' });
    }
    const created = await dbAdapter.transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO test_packages (name, description) VALUES ($1, $2) RETURNING *`,
        [String(name).trim(), description || null]
      );
      const pkg = result.rows[0];
      const list = Array.isArray(items) ? items : [];
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        await client.query(
          `INSERT INTO test_package_items (package_id, test_id, test_name, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [pkg.id, item.test_id || item.id, item.test_name || item.name || null, i]
        );
      }
      return pkg;
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating package:', error);
    res.status(500).json({ error: 'Failed to create package' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, description, status, items } = req.body;
    const updated = await dbAdapter.transaction(async (client) => {
      const result = await client.query(
        `UPDATE test_packages SET
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          status = COALESCE($3, status),
          updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [name, description, status, req.params.id]
      );
      if (!result.rows.length) return null;
      if (Array.isArray(items)) {
        await client.query('DELETE FROM test_package_items WHERE package_id = $1', [req.params.id]);
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          await client.query(
            `INSERT INTO test_package_items (package_id, test_id, test_name, sort_order)
             VALUES ($1, $2, $3, $4)`,
            [req.params.id, item.test_id || item.id, item.test_name || item.name || null, i]
          );
        }
      }
      return result.rows[0];
    });
    if (!updated) return res.status(404).json({ error: 'Package not found' });
    res.json(updated);
  } catch (error) {
    console.error('Error updating package:', error);
    res.status(500).json({ error: 'Failed to update package' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await dbAdapter.execute(
      `UPDATE test_packages SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ message: 'Package deactivated' });
  } catch (error) {
    console.error('Error deactivating package:', error);
    res.status(500).json({ error: 'Failed to deactivate package' });
  }
});

/** Apply package to an article — expands into article_tests (requires dueDate). */
router.post('/:id/apply', async (req, res) => {
  try {
    const { articleId, dueDate, executionType = 'inhouse' } = req.body;
    if (!articleId) return res.status(400).json({ error: 'articleId is required' });
    if (!dueDate) return res.status(400).json({ error: 'dueDate is required' });

    const pkgRows = await dbAdapter.query('SELECT * FROM test_packages WHERE id = $1', [req.params.id]);
    if (!pkgRows.length) return res.status(404).json({ error: 'Package not found' });
    const items = await dbAdapter.query(
      `SELECT * FROM test_package_items WHERE package_id = $1 ORDER BY sort_order`,
      [req.params.id]
    );
    if (!items.length) return res.status(400).json({ error: 'Package has no tests' });

    const { getDefaultTesterId } = require('../services/defaultTester');
    const created = await dbAdapter.transaction(async (client) => {
      const batchNumber = `PKG-${String(Date.now()).slice(-6)}`;
      const batchResult = await client.query(
        `INSERT INTO test_batches (article_id, batch_number, notes, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`,
        [articleId, batchNumber, `Applied package: ${pkgRows[0].name}`]
      );
      const batchId = batchResult.rows[0].id;
      const defaultTesterId = await getDefaultTesterId(client);
      const inserted = [];

      for (const item of items) {
        let lib = null;
        if (item.test_id) {
          const libRows = await client.query('SELECT * FROM tests WHERE id = $1', [item.test_id]);
          lib = libRows.rows[0] || null;
        }
        const result = await client.query(
          `INSERT INTO article_tests (
            article_id, batch_id, test_name, test_standard, client_requirement,
            category, execution_type, inhouse_test_id, assigned_tester_id, test_deadline,
            assigned_at, assigned_by, status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),1,'assigned')
          RETURNING id, test_name`,
          [
            articleId,
            batchId,
            item.test_name || lib?.name || item.test_id,
            lib?.standard || null,
            lib?.description || null,
            lib?.category || 'Finished Good',
            executionType,
            item.test_id,
            executionType === 'outsource' ? null : defaultTesterId,
            dueDate,
          ]
        );
        inserted.push(result.rows[0]);
      }
      return { batchId, tests: inserted };
    });

    res.status(201).json({ message: 'Package applied', ...created });
  } catch (error) {
    console.error('Error applying package:', error);
    res.status(500).json({ error: error.message || 'Failed to apply package' });
  }
});

module.exports = router;
