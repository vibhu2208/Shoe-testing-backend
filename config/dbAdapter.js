const { pool } = require('./database');

class DatabaseAdapter {
  constructor() {
    this.pool = pool;
  }

  async query(sql, params = []) {
    try {
      console.log('Executing query:', sql);
      console.log('With parameters:', params);
      const client = await this.pool.connect();
      try {
        const result = await client.query(sql, params);
        console.log('Query successful, rows returned:', result.rows.length);
        return result.rows;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Database query error:', error);
      console.error('Failed query:', sql);
      console.error('Failed params:', params);
      throw error;
    }
  }

  async execute(sql, params = []) {
    try {
      const client = await this.pool.connect();
      try {
        const result = await client.query(sql, params);
        return result;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Database execute error:', error);
      throw error;
    }
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async testConnection() {
    try {
      const result = await this.query('SELECT NOW() as current_time');
      console.log('Database connection successful:', result[0]);
      return true;
    } catch (error) {
      console.error('Database connection failed:', error);
      return false;
    }
  }
}

module.exports = new DatabaseAdapter();
