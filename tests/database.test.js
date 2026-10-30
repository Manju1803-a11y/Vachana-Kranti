const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const {
  checkDatabaseConnection,
  databaseErrorDetails,
  getDatabaseConfig,
  retryDatabaseConnection,
  runMigrations
} = require("../database");

test("production database configuration requires DATABASE_URL", () => {
  const config = getDatabaseConfig({ NODE_ENV: "production" });
  assert.equal(config.mode, "unavailable");
  assert.match(config.error, /DATABASE_URL is required/);
});

test("non-production configuration retains local file storage without a database URL", () => {
  assert.equal(getDatabaseConfig({ NODE_ENV: "development" }).mode, "local-file");
});

test("PostgreSQL connection configuration validates URL scheme and TLS mode", () => {
  const config = getDatabaseConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://editor@db.example.test/vachana?sslmode=require"
  });
  assert.equal(config.mode, "postgres");
  assert.equal(config.ssl.rejectUnauthorized, false);
  assert.equal(config.poolOptions.connectionTimeoutMillis, 5000);
  assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false);

  assert.equal(getDatabaseConfig({
    NODE_ENV: "production",
    DATABASE_URL: "mysql://db.example.test/vachana"
  }).mode, "unavailable");
  assert.equal(getDatabaseConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://db.example.test/vachana",
    DATABASE_SSL: "invalid"
  }).mode, "unavailable");
});

test("database connectivity check succeeds and retries transient failures", async () => {
  let attempts = 0;
  const pool = {
    async query(sql) {
      assert.equal(sql, "SELECT 1");
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("unavailable");
        error.code = "ECONNREFUSED";
        throw error;
      }
      return { rows: [{ "?column?": 1 }] };
    }
  };

  await retryDatabaseConnection(pool, { attempts: 2, delay: () => 0 });
  assert.equal(attempts, 2);
  await checkDatabaseConnection({ query: async () => ({ rows: [] }) });
});

test("database connectivity errors expose only a safe error code", () => {
  const error = new Error("connection failed for postgres://user:secret@host/db");
  error.code = "ECONNREFUSED";
  assert.deepEqual(databaseErrorDetails(error), { code: "ECONNREFUSED" });
});

test("schema migrations are recorded and safely skipped after first application", async () => {
  const appliedVersions = new Set();
  const executedMigrations = [];
  let releaseCount = 0;
  const client = {
    async query(sql, values = []) {
      const statement = sql.trim();
      if (statement.startsWith("SELECT version FROM schema_migrations")) {
        return { rows: appliedVersions.has(values[0]) ? [{ version: values[0] }] : [] };
      }
      if (statement.startsWith("INSERT INTO schema_migrations")) {
        appliedVersions.add(values[0]);
        return { rows: [] };
      }
      if (statement.startsWith("CREATE TABLE IF NOT EXISTS issues")) {
        executedMigrations.push(statement);
      }
      return { rows: [] };
    },
    release() {
      releaseCount += 1;
    }
  };
  const pool = { connect: async () => client };
  const migrationDirectory = path.join(__dirname, "..", "scripts", "migrations");

  await runMigrations(pool, migrationDirectory);
  await runMigrations(pool, migrationDirectory);

  assert.deepEqual([...appliedVersions], ["001"]);
  assert.equal(executedMigrations.length, 1);
  assert.equal(releaseCount, 2);
});

test("migration failure rolls back and releases its connection", async () => {
  const statements = [];
  const client = {
    async query(sql) {
      const statement = sql.trim();
      statements.push(statement);
      if (statement.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) {
        throw new Error("migration failed");
      }
      return { rows: [] };
    },
    release() {
      statements.push("RELEASE");
    }
  };

  await assert.rejects(runMigrations({ connect: async () => client }), /migration failed/);
  assert.ok(statements.includes("ROLLBACK"));
  assert.ok(statements.includes("RELEASE"));
});
