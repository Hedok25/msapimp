import { getDatabase } from '../db/index.js';
import { dbLogger } from '../logging/index.js';
import { rateLimitAlertService } from './rate-limit-alert.service.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Загружаем конфиг из исходной директории (не из dist)
const configPath = path.resolve(__dirname, '../../src/config/rate_limits.json');
const rateLimitsConfig = JSON.parse(
  fs.readFileSync(configPath, 'utf-8')
);

/**
 * Тарифы клиентов
 */
export interface RateLimitTier {
  requests: number;
  window_sec: number;
  burst: number;
  concurrent: number;
}

/**
 * Результат проверки лимита
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
  retryAfter?: number;
  level: RateLimitLevel;
  key: string;
}

export type RateLimitLevel = 'global' | 'client' | 'marketplace' | 'store' | 'token' | 'endpoint';

/**
 * Ключ для кэширования
 */
interface CacheKey {
  level: RateLimitLevel;
  key: string;
  window: number;
}

/**
 * Запись в кэше счётчиков
 */
interface CounterCache {
  count: number;
  windowStart: number;
  windowEnd: number;
}

/**
 * Сервис управления Rate Limiting
 * Реализует 6-уровневую иерархию проверки лимитов
 */
export class RateLimitService {
  private static instance: RateLimitService;
  
  // In-Memory кэш счётчиков (TTL = окно лимита)
  private countersCache: Map<string, CounterCache> = new Map();
  
  // In-Memory кэш конфигураций (TTL 5 мин)
  private configCache: Map<string, any> = new Map();
  private configCacheTimestamps: Map<string, number> = new Map();
  private readonly CONFIG_TTL_MS = 5 * 60 * 1000; // 5 минут
  
  // In-Memory кэш связей client → stores → tokens (TTL 5 мин)
  private storesCache: Map<string, any[]> = new Map();
  private tokensCache: Map<string, any[]> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут
  
  private constructor() {}
  
  static getInstance(): RateLimitService {
    if (!RateLimitService.instance) {
      RateLimitService.instance = new RateLimitService();
    }
    return RateLimitService.instance;
  }
  
  /**
   * Проверка всех уровней rate limiting
   * @returns Результат проверки или null если все лимиты пройдены
   */
  async checkAllLimits(params: {
    ip: string;
    clientId: string;
    rateTier: string;
    marketplaceId: string;
    storeId?: number;
    tokenId?: number;
    endpoint?: string;
  }): Promise<RateLimitResult | null> {
    const { ip, clientId, rateTier, marketplaceId, storeId, tokenId, endpoint } = params;
    
    // Уровень 1: Global IP Limit
    const globalResult = await this.checkGlobalLimit(ip);
    if (!globalResult.allowed) {
      return globalResult;
    }
    
    // Уровень 2: Client Limit (по тарифу)
    const clientResult = await this.checkClientLimit(clientId, rateTier);
    if (!clientResult.allowed) {
      return clientResult;
    }
    
    // Уровень 3: Marketplace Limit (суммарно по всем магазинам на МП)
    const marketplaceResult = await this.checkMarketplaceLimit(clientId, marketplaceId);
    if (!marketplaceResult.allowed) {
      return marketplaceResult;
    }
    
    // Уровень 4: Store Limit (если указан магазин)
    if (storeId) {
      const storeResult = await this.checkStoreLimit(clientId, storeId);
      if (!storeResult.allowed) {
        return storeResult;
      }
    }
    
    // Уровень 5: Token Limit (если указан токен)
    if (tokenId) {
      const tokenResult = await this.checkTokenLimit(tokenId);
      if (!tokenResult.allowed) {
        return tokenResult;
      }
    }
    
    // Уровень 6: Endpoint Limit (если указан эндпоинт)
    if (endpoint) {
      const endpointResult = await this.checkEndpointLimit(clientId, storeId || 0, endpoint);
      if (!endpointResult.allowed) {
        return endpointResult;
      }
    }
    
    // Все лимиты пройдены
    return null;
  }
  
  /**
   * Уровень 1: Global IP Limit
   */
  async checkGlobalLimit(ip: string): Promise<RateLimitResult> {
    const config = rateLimitsConfig.global.ip;
    const key = `global:ip:${ip}`;
    
    return this.checkLimit(key, config.requests, config.window_sec, 'global');
  }
  
  /**
   * Уровень 2: Client Limit (по тарифу)
   */
  async checkClientLimit(clientId: string, rateTier: string): Promise<RateLimitResult> {
    // Проверяем кэш конфигурации тарифа
    const tierConfig = this.getTierConfig(rateTier);
    const key = `client:${clientId}`;
    
    return this.checkLimit(key, tierConfig.requests, tierConfig.window_sec, 'client');
  }
  
  /**
   * Уровень 3: Marketplace Limit
   */
  async checkMarketplaceLimit(clientId: string, marketplaceId: string): Promise<RateLimitResult> {
    // Проверяем кастомный лимит в БД
    const customLimit = await this.getCustomLimit('marketplace', `${clientId}:${marketplaceId}`);
    
    if (customLimit) {
      const key = `marketplace:${clientId}:${marketplaceId}`;
      return this.checkLimit(key, customLimit.requests, customLimit.window_sec, 'marketplace');
    }
    
    // Используем лимит по умолчанию из тарифа
    const tierConfig = this.getTierConfig('basic'); // Дефолтный лимит на МП
    const key = `marketplace:${clientId}:${marketplaceId}`;
    
    return this.checkLimit(key, tierConfig.requests, tierConfig.window_sec, 'marketplace');
  }
  
  /**
   * Уровень 4: Store Limit
   */
  async checkStoreLimit(clientId: string, storeId: number): Promise<RateLimitResult> {
    // Проверяем кастомный лимит в БД
    const customLimit = await this.getCustomLimit('store', `${storeId}`);
    
    if (customLimit) {
      const key = `store:${storeId}`;
      return this.checkLimit(key, customLimit.requests, customLimit.window_sec, 'store');
    }
    
    // Лимит по умолчанию для магазина
    const config = rateLimitsConfig.tiers.premium;
    const key = `store:${storeId}`;
    
    return this.checkLimit(key, config.requests, config.window_sec, 'store');
  }
  
  /**
   * Уровень 5: Token Limit
   */
  async checkTokenLimit(tokenId: number): Promise<RateLimitResult> {
    // Проверяем кастомный лимит в mp_tokens
    const db = getDatabase();
    const token = db.prepare('SELECT rate_limit_override FROM mp_tokens WHERE id = ?').get(tokenId) as any;
    
    if (token?.rate_limit_override) {
      const key = `token:${tokenId}`;
      return this.checkLimit(key, token.rate_limit_override, 60, 'token');
    }
    
    // Лимит по умолчанию для токена
    const config = rateLimitsConfig.tiers.premium;
    const key = `token:${tokenId}`;
    
    return this.checkLimit(key, config.requests, config.window_sec, 'token');
  }
  
  /**
   * Уровень 6: Endpoint Limit
   */
  async checkEndpointLimit(clientId: string, storeId: number, endpoint: string): Promise<RateLimitResult> {
    // Проверяем кастомный лимит в БД
    const customLimit = await this.getCustomLimit('endpoint', `${clientId}:${storeId}:${endpoint}`);
    
    if (customLimit) {
      const key = `endpoint:${clientId}:${storeId}:${endpoint}`;
      return this.checkLimit(key, customLimit.requests, customLimit.window_sec, 'endpoint');
    }
    
    // Проверяем конфиг маркетплейса для эндпоинта
    // (упрощённо, нужно уточнять marketplace_id)
    const config = rateLimitsConfig.tiers.enterprise;
    const key = `endpoint:${clientId}:${storeId}:${endpoint}`;
    
    return this.checkLimit(key, config.requests, config.window_sec, 'endpoint');
  }
  
  /**
   * Базовая проверка лимита (скользящее окно)
   */
  private async checkLimit(
    key: string,
    limit: number,
    windowSec: number,
    level: RateLimitLevel
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSec * 1000;
    
    // Проверяем кэш счётчиков
    let counter = this.countersCache.get(key);
    
    if (!counter || now >= counter.windowEnd) {
      // Окно истекло, создаём новое
      counter = {
        count: 0,
        windowStart: now,
        windowEnd: now + windowMs
      };
      this.countersCache.set(key, counter);
    }
    
    // Увеличиваем счётчик
    counter.count++;
    
    // Сохраняем в БД для персистентности (асинхронно)
    this.saveCounterToDb(key, counter.count, counter.windowStart, counter.windowEnd).catch(err => {
      dbLogger.error('Failed to save rate limit counter', { errorShort: err.message });
    });
    
    const remaining = Math.max(0, limit - counter.count);
    const reset = Math.ceil(counter.windowEnd / 1000);
    
    if (counter.count > limit) {
      // Лимит превышен
      const retryAfter = Math.ceil((counter.windowEnd - now) / 1000);
      
      dbLogger.warn(`Rate limit exceeded: ${level} (${key})`, {
        metadata: { count: counter.count, limit, retryAfter }
      });
      
      // Записываем превышение для алертов
      const clientId = this.extractClientId(key);
      if (clientId) {
        rateLimitAlertService.recordViolation({
          clientId,
          level,
          key,
          limit,
          count: counter.count
        }).catch(err => {
          dbLogger.error('Failed to record violation', { errorShort: err.message });
        });
      }
      
      return {
        allowed: false,
        limit,
        remaining: 0,
        reset,
        retryAfter,
        level,
        key
      };
    }
    
    return {
      allowed: true,
      limit,
      remaining,
      reset,
      level,
      key
    };
  }
  
  /**
   * Получение конфигурации тарифа
   */
  private getTierConfig(tier: string): RateLimitTier {
    const config = (rateLimitsConfig.tiers as any)[tier];
    if (!config) {
      dbLogger.warn(`Unknown rate tier: ${tier}, using basic`);
      return rateLimitsConfig.tiers.basic;
    }
    return config;
  }
  
  /**
   * Получение кастомного лимита из БД
   */
  private async getCustomLimit(level: string, key: string): Promise<{ requests: number; window_sec: number } | null> {
    const cacheKey = `config:${level}:${key}`;
    const now = Date.now();
    
    // Проверяем кэш конфигураций
    const cached = this.configCache.get(cacheKey);
    if (cached && now - this.configCacheTimestamps.get(cacheKey)! < this.CONFIG_TTL_MS) {
      return cached;
    }
    
    // Запрос в БД
    const db = getDatabase();
    const row = db.prepare(`
      SELECT requests, window_sec FROM rate_limit_configs
      WHERE level = ? AND key = ? AND is_active = 1
    `).get(level, key) as any;
    
    if (row) {
      const result = { requests: row.requests, window_sec: row.window_sec };
      this.configCache.set(cacheKey, result);
      this.configCacheTimestamps.set(cacheKey, now);
      return result;
    }
    
    return null;
  }
  
  /**
   * Сохранение счётчика в БД
   */
  private async saveCounterToDb(
    key: string,
    count: number,
    windowStart: number,
    windowEnd: number
  ): Promise<void> {
    const db = getDatabase();
    const windowStartStr = new Date(windowStart).toISOString();
    const windowEndStr = new Date(windowEnd).toISOString();
    
    db.prepare(`
      INSERT INTO rate_limit_counters (key, count, window_start, window_end, last_updated)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        count = excluded.count,
        window_start = excluded.window_start,
        window_end = excluded.window_end,
        last_updated = CURRENT_TIMESTAMP
    `).run(key, count, windowStartStr, windowEndStr);
  }
  
  /**
   * Получение текущих лимитов для клиента
   */
  async getClientLimits(clientId: string): Promise<any[]> {
    const db = getDatabase();
    
    const rows = db.prepare(`
      SELECT level, key, requests, window_sec, burst, concurrent, is_active
      FROM rate_limit_configs
      WHERE key LIKE ?
      ORDER BY level, key
    `).all(`${clientId}%`) as any[];
    
    return rows;
  }
  
  /**
   * Установка кастомного лимита
   */
  async setCustomLimit(params: {
    level: RateLimitLevel;
    key: string;
    requests: number;
    window_sec: number;
    burst?: number;
    concurrent?: number;
  }): Promise<void> {
    const db = getDatabase();
    const { level, key, requests, window_sec, burst, concurrent } = params;
    
    db.prepare(`
      INSERT INTO rate_limit_configs (level, key, requests, window_sec, burst, concurrent, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(level, key) DO UPDATE SET
        requests = excluded.requests,
        window_sec = excluded.window_sec,
        burst = excluded.burst,
        concurrent = excluded.concurrent,
        updated_at = CURRENT_TIMESTAMP
    `).run(level, key, requests, window_sec, burst || null, concurrent || null);
    
    // Очищаем кэш
    const cacheKey = `config:${level}:${key}`;
    this.configCache.delete(cacheKey);
  }
  
  /**
   * Сброс счётчика
   */
  async resetCounter(key: string): Promise<void> {
    this.countersCache.delete(key);
    
    const db = getDatabase();
    db.prepare('DELETE FROM rate_limit_counters WHERE key = ?').run(key);
  }
  
  /**
   * Очистка старых кэшей (фоновая задача)
   */
  startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();

      // Очистка кэша конфигураций
      for (const [key, timestamp] of this.configCacheTimestamps.entries()) {
        if (now - timestamp > this.CONFIG_TTL_MS) {
          this.configCache.delete(key);
          this.configCacheTimestamps.delete(key);
        }
      }

      // Очистка старых счётчиков
      for (const [key, counter] of this.countersCache.entries()) {
        if (now >= counter.windowEnd) {
          this.countersCache.delete(key);
        }
      }

      dbLogger.debug('Rate limit cache cleanup completed');
    }, 60 * 1000); // Каждую минуту
  }
  
  /**
   * Извлечение client_id из ключа
   */
  private extractClientId(key: string): string | null {
    // Форматы ключей:
    // global:ip:192.168.1.1
    // client:client_123
    // marketplace:client_123:ozon
    // store:123
    // token:456
    // endpoint:client_123:123:/api/v1/...
    
    const parts = key.split(':');
    
    if (parts[0] === 'client') {
      return parts[1];
    }
    
    if (parts[0] === 'marketplace' || parts[0] === 'endpoint') {
      return parts[1];
    }
    
    // Для store и token нужно искать в БД
    return null;
  }
}

// Экспорт единственного экземпляра
export const rateLimitService = RateLimitService.getInstance();
