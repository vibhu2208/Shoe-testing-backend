const { pool } = require('./config/database');

(async () => {
  try {
    const client = await pool.connect();
    
    // Test the exact query from the API
    const query = `
      SELECT
        at.id,
        at.test_name,
        at.test_standard,
        at.client_requirement,
        at.category,
        at.execution_type,
        at.inhouse_test_id,
        at.status,
        at.test_deadline,
        at.assigned_at,
        at.notes as admin_notes,
        
        -- Article details (OK to show)
        a.article_name,
        a.article_number,
        a.material_type,
        a.color,
        a.description
        
        -- NO client details excluded

      FROM article_tests at
      JOIN articles a ON at.article_id = a.id

      WHERE at.assigned_tester_id = $1
      AND at.execution_type = 'inhouse'

      ORDER BY at.test_deadline ASC NULLS LAST
    `;
    
    const result = await client.query(query, [2]);
    console.log('API query results count:', result.rows.length);
    console.log('First result:', JSON.stringify(result.rows[0], null, 2));
    
    client.release();
  } catch (error) {
    console.error('Database error:', error);
  }
})();
