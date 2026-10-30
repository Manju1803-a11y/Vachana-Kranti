CREATE TABLE IF NOT EXISTS issues (
  id         CHAR(12) PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issue_files (
  id         SERIAL PRIMARY KEY,
  issue_id   CHAR(12) NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  name       TEXT NOT NULL,
  file_path  TEXT NOT NULL,
  type       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  data       BYTEA NOT NULL
);

CREATE INDEX IF NOT EXISTS issue_files_issue_id_idx ON issue_files(issue_id, sort_order);

CREATE TABLE IF NOT EXISTS app_data (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
