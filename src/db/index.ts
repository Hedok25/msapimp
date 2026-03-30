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
      
      -- PAGINATION FIELDS
      group_id TEXT,                    -- Группа запросов (для пагинации)
      page_number INTEGER DEFAULT 1,    -- Номер страницы
      next_page_url TEXT,               -- URL следующей страницы
      is_last_page INTEGER DEFAULT 0,   -- Последняя ли страница
      parent_request_id TEXT,           -- Ссылка на родительский запрос
      
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

  // RATE LIMITING TABLES

  // Таблица магазинов (stores)
  database.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      marketplace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      external_store_id TEXT,
      settings TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(client_id, marketplace_id, external_store_id)
    )
  `);

  // Таблица токенов маркетплейсов (mp_tokens)
  database.exec(`
    CREATE TABLE IF NOT EXISTS mp_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      marketplace_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      token_encrypted TEXT,
      token_prefix TEXT,
      expires_at DATETIME,
      refresh_token_encrypted TEXT,
      is_active INTEGER DEFAULT 1,
      is_primary INTEGER DEFAULT 0,
      rate_limit_override INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME,
      FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
    )
  `);

  // Таблица конфигурации лимитов (rate_limit_configs)
  database.exec(`
    CREATE TABLE IF NOT EXISTS rate_limit_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      key TEXT NOT NULL,
      requests INTEGER NOT NULL,
      window_sec INTEGER NOT NULL,
      burst INTEGER,
      concurrent INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(level, key)
    )
  `);

  // Таблица лимитов клиента на маркетплейс (client_mp_limits)
  database.exec(`
    CREATE TABLE IF NOT EXISTS client_mp_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      marketplace_id TEXT NOT NULL,
      custom_requests INTEGER,
      custom_window_sec INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(client_id, marketplace_id)
    )
  `);

  // Таблица счётчиков rate limits (rate_limit_counters)
  database.exec(`
    CREATE TABLE IF NOT EXISTS rate_limit_counters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      count INTEGER DEFAULT 0,
      window_start DATETIME NOT NULL,
      window_end DATETIME NOT NULL,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Индексы для rate limiting
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_stores_client ON stores(client_id);
    CREATE INDEX IF NOT EXISTS idx_stores_marketplace ON stores(marketplace_id);
    CREATE INDEX IF NOT EXISTS idx_stores_active ON stores(is_active);
    CREATE INDEX IF NOT EXISTS idx_mp_tokens_store ON mp_tokens(store_id);
    CREATE INDEX IF NOT EXISTS idx_mp_tokens_active ON mp_tokens(is_active, marketplace_id);
    CREATE INDEX IF NOT EXISTS idx_rate_limits_level ON rate_limit_configs(level, key);
    CREATE INDEX IF NOT EXISTS idx_client_mp_limits ON client_mp_limits(client_id, marketplace_id);
    CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_key ON rate_limit_counters(key);
    CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window ON rate_limit_counters(window_end);
  `);

  // CIRCUIT BREAKER TABLES
  database.exec(`
    CREATE TABLE IF NOT EXISTS circuit_breaker_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace_id TEXT UNIQUE NOT NULL,
      config_json TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS circuit_breaker_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace_id TEXT UNIQUE NOT NULL,
      state TEXT NOT NULL,
      failures INTEGER DEFAULT 0,
      successes INTEGER DEFAULT 0,
      opened_at DATETIME,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_cb_configs_marketplace ON circuit_breaker_configs(marketplace_id);
    CREATE INDEX IF NOT EXISTS idx_cb_stats_marketplace ON circuit_breaker_stats(marketplace_id);
  `);

  // PAGINATION TABLES
  database.exec(`
    CREATE TABLE IF NOT EXISTS request_groups (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      marketplace_id TEXT NOT NULL,
      original_url TEXT NOT NULL,
      original_method TEXT NOT NULL,
      total_pages INTEGER,
      completed_pages INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      pagination_type TEXT,
      pagination_config TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_request_groups_client ON request_groups(client_id);
    CREATE INDEX IF NOT EXISTS idx_request_groups_status ON request_groups(status);
    CREATE INDEX IF NOT EXISTS idx_request_groups_created ON request_groups(created_at);
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

  // МИГРАЦИИ: Добавляем новые поля в существующие таблицы
  // Поле group_id может уже существовать, поэтому используем ALTER TABLE с проверкой
  try {
    database.exec(`ALTER TABLE requests ADD COLUMN group_id TEXT`);
  } catch (e) {
    // Игнорируем ошибку, если колонка уже существует
  }
  try {
    database.exec(`ALTER TABLE requests ADD COLUMN page_number INTEGER DEFAULT 1`);
  } catch (e) {}
  try {
    database.exec(`ALTER TABLE requests ADD COLUMN next_page_url TEXT`);
  } catch (e) {}
  try {
    database.exec(`ALTER TABLE requests ADD COLUMN is_last_page INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    database.exec(`ALTER TABLE requests ADD COLUMN parent_request_id TEXT`);
  } catch (e) {}

  // Создаём индексы для новых полей
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_group ON requests(group_id);
    CREATE INDEX IF NOT EXISTS idx_requests_page ON requests(group_id, page_number);
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
