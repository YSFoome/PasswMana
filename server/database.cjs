const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'password-manager.db'));

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===== Schema =====
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    password_hint TEXT DEFAULT '',
    recovery_code_encrypted TEXT DEFAULT '',
    recovery_code_stored TEXT DEFAULT '',
    unlock_pin_hash TEXT DEFAULT '',
    id_card TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    nickname TEXT DEFAULT '',
    birthday TEXT DEFAULT '',
    created_at TEXT NOT NULL
  )
`);

// Migration: add column if it doesn't exist
try { db.exec('ALTER TABLE users ADD COLUMN recovery_code_stored TEXT DEFAULT \'\''); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS vault_entries (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    type TEXT NOT NULL,
    site_name TEXT NOT NULL,
    account TEXT NOT NULL,
    password_encrypted TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (username) REFERENCES users(username)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS custom_types (
    username TEXT NOT NULL,
    type_name TEXT NOT NULL,
    PRIMARY KEY (username, type_name),
    FOREIGN KEY (username) REFERENCES users(username)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    username TEXT PRIMARY KEY,
    encrypted_password TEXT NOT NULL,
    saved_at INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS remembered_accounts (
    username TEXT PRIMARY KEY,
    encrypted_password TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    fail_count INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS device_token (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token TEXT NOT NULL
  )
`);

// ===== Prepared statements for performance =====
const stmts = {
  // Users
  getUser: db.prepare('SELECT * FROM users WHERE username = ?'),
  saveUser: db.prepare(`INSERT OR REPLACE INTO users (username, password_hash, password_hint, recovery_code_encrypted, recovery_code_stored, unlock_pin_hash, id_card, phone, nickname, birthday, created_at)
    VALUES (@username, @password_hash, @password_hint, @recovery_code_encrypted, @recovery_code_stored, @unlock_pin_hash, @id_card, @phone, @nickname, @birthday, @created_at)`),

  // Vault
  getEntries: db.prepare('SELECT * FROM vault_entries WHERE username = ? ORDER BY updated_at DESC'),
  saveEntry: db.prepare(`INSERT OR REPLACE INTO vault_entries (id, username, type, site_name, account, password_encrypted, notes, created_at, updated_at)
    VALUES (@id, @username, @type, @site_name, @account, @password_encrypted, @notes, @created_at, @updated_at)`),
  deleteEntry: db.prepare('DELETE FROM vault_entries WHERE id = ? AND username = ?'),

  // Custom types
  getTypes: db.prepare('SELECT type_name FROM custom_types WHERE username = ?'),
  addType: db.prepare('INSERT OR IGNORE INTO custom_types (username, type_name) VALUES (?, ?)'),
  removeType: db.prepare('DELETE FROM custom_types WHERE username = ? AND type_name = ?'),

  // Sessions
  saveSession: db.prepare('INSERT OR REPLACE INTO sessions (username, encrypted_password, saved_at) VALUES (?, ?, ?)'),
  getSession: db.prepare('SELECT * FROM sessions WHERE username = ?'),
  getLatestSession: db.prepare('SELECT * FROM sessions ORDER BY saved_at DESC LIMIT 1'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE username = ?'),

  // Remembered accounts
  getRemembered: db.prepare('SELECT * FROM remembered_accounts WHERE expires_at > ?'),
  saveRemembered: db.prepare('INSERT OR REPLACE INTO remembered_accounts (username, encrypted_password, expires_at, fail_count) VALUES (?, ?, ?, ?)'),
  deleteRemembered: db.prepare('DELETE FROM remembered_accounts WHERE username = ?'),

  // Device token
  getDeviceToken: db.prepare('SELECT token FROM device_token WHERE id = 1'),
  setDeviceToken: db.prepare('INSERT OR REPLACE INTO device_token (id, token) VALUES (1, ?)'),
};

module.exports = { db, stmts };
