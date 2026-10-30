// check_db.js – simple script to test PostgreSQL connection for Vachana Kranti
const { createDatabasePool, databaseErrorDetails, getDatabaseConfig } = require('../database');

// Load env variables from .env if present (dev only)
require('dotenv').config({ path: '.env' });

const config = getDatabaseConfig({ ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' });
if (config.mode !== 'postgres') {
  console.error(config.error || '❌ DATABASE_URL not set. Set it in .env or environment variables.');
  process.exit(1);
}

const pool = createDatabasePool(config);

(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL successfully.');
    // Run a simple query to verify tables exist
    const res = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
    console.log('📋 Tables in public schema:', res.rows.map(r => r.table_name).join(', '));
  } catch (err) {
    console.error('❌ Failed to connect to PostgreSQL.', databaseErrorDetails(err));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
