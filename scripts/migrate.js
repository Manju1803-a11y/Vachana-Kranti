const { createDatabasePool, databaseErrorDetails, getDatabaseConfig, runMigrations } = require("../database");

async function main() {
  const config = getDatabaseConfig();
  if (config.mode !== "postgres") {
    throw new Error(config.error || "DATABASE_URL is required to run migrations.");
  }

  const pool = createDatabasePool(config);
  try {
    await runMigrations(pool);
    console.log("Database migrations are up to date.");
  } catch (error) {
    console.error("Database migration failed.", databaseErrorDetails(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
