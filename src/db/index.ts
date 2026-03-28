import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = path.resolve(__dirname, '../../', config.dbPath);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export async function initDatabase(): Promise<void> {
  const database = getDatabase();

  // Таблица пользователей (клиентов)
  database.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'client' CHECK(role IN ('client', 'admin')),
      rate_tier TEXT DEFAULT 'basic' CHECK(rate_tier IN ('basic', 'premium', 'enterprise')),
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица access токенов (хранение хешей для возможности отзыва)
  database.exec(`
    CREATE TABLE IF NOT EXISTS access_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      jti TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      is_revoked INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
    )
  `);

  // Таблица blacklist для JWT (резервный механизм)
  database.exec(`
    CREATE TABLE IF NOT EXISTS jwt_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jti TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица логов аутентификации
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица запросов (очередь)
  database.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      client_id TEXT NOT NULL,
      marketplace_id TEXT NOT NULL,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      headers TEXT,
      body TEXT,
      status TEXT DEFAULT 'accepted',
      response_status INTEGER,
      response_headers TEXT,
      response_body TEXT,
      error_message TEXT,
      attempts INTEGER DEFAULT 0,
      priority TEXT DEFAULT 'normal',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    )
  `);

  // Таблица логов
  database.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      level TEXT NOT NULL,
      request_id TEXT,
      client_id TEXT,
      action TEXT,
      message TEXT,
      error_short TEXT,
      error_message TEXT,
      metadata TEXT
    )
  `);

  // Таблица аудит логов
  database.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Индексы для производительности
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_uuid ON requests(uuid);
    CREATE INDEX IF NOT EXISTS idx_requests_client_id ON requests(client_id);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
    CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    CREATE INDEX IF NOT EXISTS idx_logs_client_id ON logs(client_id);
    CREATE INDEX IF NOT EXISTS idx_access_tokens_client_id ON access_tokens(client_id);
    CREATE INDEX IF NOT EXISTS idx_access_tokens_jti ON access_tokens(jti);
    CREATE INDEX IF NOT EXISTS idx_jwt_blacklist_jti ON jwt_blacklist(jti);
    CREATE INDEX IF NOT EXISTS idx_auth_logs_created_at ON auth_logs(created_at);
  `);

  // Создаем админа по умолчанию
  const bcrypt = (await import('bcrypt')).default;
  const adminEmail = config.admin.email;
  const adminClientId = 'admin-client';

  // Проверяем существование админа по client_id (уникальный ключ)
  const stmt = database.prepare('SELECT id FROM clients WHERE client_id = ?');
  const existing = stmt.get(adminClientId);

  if (!existing) {
    const passwordHash = await bcrypt.hash(config.admin.password, 10);
    const insert = database.prepare(`
      INSERT INTO clients (client_id, email, password_hash, role, rate_tier)
      VALUES (?, ?, ?, 'admin', 'enterprise')
    `);
    insert.run(adminClientId, adminEmail, passwordHash);
    console.log('Admin user created:', adminEmail);
  } else {
    console.log('Admin user already exists');
  }
}

export default { getDatabase, closeDatabase, initDatabase };
