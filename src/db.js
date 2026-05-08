const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { dbPath } = require("./config");

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_tokens (
  user_id INTEGER PRIMARY KEY,
  kintone_domain TEXT NOT NULL,
  kintone_app_id TEXT NOT NULL,
  kintone_api_token_enc TEXT NOT NULL,
  copilot_api_token_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  input_summary TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS managed_kintone_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kintone_domain TEXT NOT NULL,
  kintone_app_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(kintone_domain, kintone_app_id)
);

CREATE TABLE IF NOT EXISTS managed_kintone_app_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  managed_app_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  field_code TEXT NOT NULL,
  can_post INTEGER NOT NULL DEFAULT 1,
  can_get INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(managed_app_id) REFERENCES managed_kintone_apps(id) ON DELETE CASCADE,
  UNIQUE(managed_app_id, field_code)
);

CREATE TABLE IF NOT EXISTS user_copilot_tokens (
  user_id INTEGER PRIMARY KEY,
  copilot_api_token_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_kintone_app_tokens (
  user_id INTEGER NOT NULL,
  managed_app_id INTEGER NOT NULL,
  kintone_api_token_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, managed_app_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(managed_app_id) REFERENCES managed_kintone_apps(id) ON DELETE CASCADE
);
`);

module.exports = db;
