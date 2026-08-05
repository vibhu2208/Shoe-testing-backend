const express = require('express');
const dbAdapter = require('../config/dbAdapter');
const router = express.Router();

async function ensureVendorsTable() {
  await dbAdapter.execute(`
    CREATE TABLE IF NOT EXISTS vendors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      contact_person VARCHAR(255),
      email VARCHAR(255),
      phone VARCHAR(50),
      address TEXT,
      notes TEXT,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await dbAdapter.execute(`
    ALTER TABLE article_tests
    ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL
  `);
}

router.use(async (req, res, next) => {
  try {
    await ensureVendorsTable();
    next();
  } catch (error) {
    console.error('Vendors table ensure failed:', error);
    res.status(500).json({ error: 'Failed to initialize vendors' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { status, search } = req.query;
    let query = 'SELECT * FROM vendors WHERE 1=1';
    const params = [];
    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length} OR contact_person ILIKE $${params.length})`;
    }
    query += ' ORDER BY name ASC';
    const rows = await dbAdapter.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error listing vendors:', error);
    res.status(500).json({ error: 'Failed to list vendors' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const rows = await dbAdapter.query('SELECT * FROM vendors WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Vendor not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({ error: 'Failed to fetch vendor' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, contact_person, email, phone, address, notes, status } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Vendor name is required' });
    }
    const rows = await dbAdapter.query(
      `INSERT INTO vendors (name, contact_person, email, phone, address, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        String(name).trim(),
        contact_person || null,
        email || null,
        phone || null,
        address || null,
        notes || null,
        status === 'inactive' ? 'inactive' : 'active',
      ]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating vendor:', error);
    res.status(500).json({ error: 'Failed to create vendor' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, contact_person, email, phone, address, notes, status } = req.body;
    const rows = await dbAdapter.query(
      `UPDATE vendors SET
        name = COALESCE($1, name),
        contact_person = COALESCE($2, contact_person),
        email = COALESCE($3, email),
        phone = COALESCE($4, phone),
        address = COALESCE($5, address),
        notes = COALESCE($6, notes),
        status = COALESCE($7, status),
        updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        name != null ? String(name).trim() : null,
        contact_person,
        email,
        phone,
        address,
        notes,
        status,
        req.params.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Vendor not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating vendor:', error);
    res.status(500).json({ error: 'Failed to update vendor' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await dbAdapter.execute(
      `UPDATE vendors SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ message: 'Vendor deactivated' });
  } catch (error) {
    console.error('Error deactivating vendor:', error);
    res.status(500).json({ error: 'Failed to deactivate vendor' });
  }
});

module.exports = router;
