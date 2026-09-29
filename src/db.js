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

CREATE TABLE IF NOT EXISTS user_llm_settings (
  user_id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'github',
  anthropic_api_key_enc TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ai_operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  managed_app_id INTEGER,
  app_name TEXT,
  conversation_id TEXT,
  source TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  tool_name TEXT NOT NULL,
  access TEXT NOT NULL,
  input_json TEXT,
  status TEXT NOT NULL,
  summary TEXT,
  kintone_error_code TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// v2: kintoneスキーマ同期とAI操作ポリシー
addColumnIfMissing("managed_kintone_apps", "schema_synced_at", "TEXT");
addColumnIfMissing("managed_kintone_apps", "ai_can_read", "INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing("managed_kintone_apps", "ai_can_create", "INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing("managed_kintone_apps", "ai_can_update", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("managed_kintone_app_fields", "options_json", "TEXT");
addColumnIfMissing("managed_kintone_app_fields", "required", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("managed_kintone_app_fields", "source", "TEXT NOT NULL DEFAULT 'manual'");
addColumnIfMissing("user_llm_settings", "gemini_api_key_enc", "TEXT");

module.exports = db;
