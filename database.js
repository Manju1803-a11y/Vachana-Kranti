const { Pool } = require("pg");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIRECTORY = path.join(__dirname, "scripts", "migrations");
const MIGRATION_LOCK_ID = 248731905;

function getDatabaseConfig(env = process.env) {
  const rawUrl = typeof env.DATABASE_URL === "string" ? env.DATABASE_URL.trim() : "";
  const production = env.NODE_ENV === "production";

  if (!rawUrl) {
    return {
      mode: production ? "unavailable" : "local-file",
      error: production ? "DATABASE_URL is required in production." : null
    };
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { mode: "unavailable", error: "DATABASE_URL is not a valid PostgreSQL URL." };
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
    return { mode: "unavailable", error: "DATABASE_URL must be a PostgreSQL connection URL." };
  }

  const requestedSsl = typeof env.DATABASE_SSL === "string" ? env.DATABASE_SSL.trim().toLowerCase() : "";
  const urlSslMode = url.searchParams.get("sslmode")?.toLowerCase() || "";
  const sslMode = requestedSsl || urlSslMode || (["localhost", "127.0.0.1", "::1"].includes(url.hostname) ? "disable" : "require");
  const supportedSslModes = ["disable", "require", "verify-full"];

  if (!supportedSslModes.includes(sslMode)) {
    return { mode: "unavailable", error: "DATABASE_SSL must be disable, require, or verify-full." };
  }

  url.searchParams.delete("sslmode");
  const ssl = sslMode === "disable"
    ? false
    : sslMode === "verify-full"
      ? { rejectUnauthorized: true }
      : { rejectUnauthorized: false };

  return {
    mode: "postgres",
    connectionString: url.toString(),
    ssl,
    poolOptions: {
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      keepAlive: true,
      application_name: "vachana-kranti"
    }
  };
}

function createDatabasePool(config, logger = console) {
  if (config.mode !== "postgres") return null;

  const pool = new Pool({
    connectionString: config.connectionString,
    ssl: config.ssl,
    ...config.poolOptions
  });
  pool.on("error", (error) => {
    logger.error("PostgreSQL idle connection error.", { code: error.code || "UNKNOWN" });
  });
  return pool;
}

function databaseErrorDetails(error) {
  return { code: error && error.code ? String(error.code) : "UNKNOWN" };
}

async function checkDatabaseConnection(pool) {
  await pool.query("SELECT 1");
}

async function retryDatabaseConnection(pool, options = {}) {
  const attempts = options.attempts || 3;
  const delay = options.delay || ((attempt) => 500 * (2 ** (attempt - 1)));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await checkDatabaseConnection(pool);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delay(attempt)));
      }
    }
  }

  throw lastError;
}

async function runMigrations(pool, migrationsDirectory = MIGRATIONS_DIRECTORY) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = fs.readdirSync(migrationsDirectory)
      .filter((file) => /^\d+[-_].+\.sql$/.test(file))
      .sort();

    for (const file of files) {
      const version = file.match(/^(\d+)[-_]/)[1];
      const { rows } = await client.query("SELECT version FROM schema_migrations WHERE version=$1", [version]);
      if (rows.length) continue;

      const sql = fs.readFileSync(path.join(migrationsDirectory, file), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [version]);
    }

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the migration error if the connection also failed during rollback.
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  checkDatabaseConnection,
  createDatabasePool,
  databaseErrorDetails,
  getDatabaseConfig,
  retryDatabaseConnection,
  runMigrations
};
