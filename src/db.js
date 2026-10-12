const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  tax_id           TEXT,
  email            TEXT,
  phone            TEXT,
  api_token_hash   TEXT NOT NULL UNIQUE,
  api_token_prefix TEXT NOT NULL,
  webhook_url      TEXT,
  webhook_secret   TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1,
  last_login_at    TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  telegram_bot_id TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  username        TEXT NOT NULL,
  token_enc       TEXT NOT NULL,
  webhook_secret  TEXT NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'polling',
  status          TEXT NOT NULL DEFAULT 'pending',
  last_error      TEXT,
  update_offset   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chats (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bot_id          INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  chat_id         TEXT NOT NULL,
  type            TEXT,
  title           TEXT,
  username        TEXT,
  last_message    TEXT,
  last_message_at TEXT,
  unread          INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bot_id, chat_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bot_id              INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  chat_ref            INTEGER REFERENCES chats(id) ON DELETE CASCADE,
  chat_id             TEXT NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('in','out')),
  type                TEXT NOT NULL DEFAULT 'text',
  text                TEXT,
  media_url           TEXT,
  telegram_message_id INTEGER,
  sender_name         TEXT,
  status              TEXT NOT NULL,
  error               TEXT,
  raw                 TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_company ON messages(company_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_ref, id);
CREATE INDEX IF NOT EXISTS idx_chats_company ON chats(company_id, last_message_at);
`);

module.exports = db;
