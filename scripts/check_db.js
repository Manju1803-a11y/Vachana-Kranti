// check_db.js – simple script to test PostgreSQL connection for Vachana Kranti
const { Pool } = require('pg');

// Load env variables from .env if present (dev only)
require('dotenv').config({ path: '.env' });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ DATABASE_URL not set. Set it in .env or environment variables.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  // If using Render's hosted DB, SSL is required but self-signed certs are allowed.
  ssl: connectionString.includes('render.com') ? { rejectUnauthorized: false } : false,
});

(async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL successfully.');
    // Run a simple query to verify tables exist
    const res = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
    console.log('📋 Tables in public schema:', res.rows.map(r => r.table_name).join(', '));
    client.release();
  } catch (err) {
    console.error('❌ Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();

