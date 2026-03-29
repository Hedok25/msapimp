import { dbLogger } from '../logging/index.js';
import { getDatabase } from '../db/index.js';

/**
 * Состояния Circuit Breaker
 */
export enum CircuitState {
  CLOSED = 'closed',      // Нормальная работа
  OPEN = 'open',          // Маркетплейс недоступен
  HALF_OPEN = 'half-open' // Тестовый режим
}

/**
 * Конфигурация Circuit Breaker
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;        // Порог ошибок для открытия
  failureWindowSec: number;        // Окно подсчёта ошибок (сек)
  openTimeoutSec: number;          // Таймаут в открытом состоянии (сек)
  halfOpenMaxRequests: number;     // Макс запросов в half-open
  successThreshold: number;        // Порог успехов для закрытия
  errorCodes: number[];            // Коды ошибок для подсчёта
  excludeCodes: number[];          // Коды, не считающиеся ошибками
}

/**
 * Статистика Circuit Breaker
 */
export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt?: Date;
  lastSuccessAt?: Date;
  openedAt?: Date;
  halfOpenRequests: number;
}

/**
 * Circuit Breaker для одного маркетплейса
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number[] = []; // Временные метки ошибок
  private successes: number = 0;
  private halfOpenRequests: number = 0;
  private openedAt?: Date;
  private lastFailureAt?: Date;
  private lastSuccessAt?: Date;

  constructor(
    private marketplaceId: string,
    private config: CircuitBreakerConfig
  ) {}

  /**
   * Проверка: можно ли выполнять запрос
   */
  canExecute(): boolean {
    const now = Date.now();

    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      // Проверяем, истёк ли таймаут
      if (this.openedAt) {
        const elapsed = (now - this.openedAt.getTime()) / 1000;
        if (elapsed >= this.config.openTimeoutSec) {
          this.transitionToHalfOpen();
          return true;
        }
      }
      return false;
    }

    if (this.state === CircuitState.HALF_OPEN) {
      // Разрешаем ограниченное количество запросов
      return this.halfOpenRequests < this.config.halfOpenMaxRequests;
    }

    return false;
  }

  /**
   * Запись успешного выполнения
   */
  recordSuccess(): void {
    const now = new Date();
    this.lastSuccessAt = now;
    this.successes++;

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenRequests++;

      // Проверяем, достаточно ли успехов для закрытия
      if (this.halfOpenRequests >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Очищаем старые ошибки при успехе
      this.cleanOldFailures();
    }
  }

  /**
   * Запись ошибки
   */
  recordFailure(statusCode?: number): void {
    const now = Date.now();
    this.lastFailureAt = new Date();

    // Проверяем, считается ли этот код ошибкой
    if (statusCode && this.config.excludeCodes.includes(statusCode)) {
      return;
    }

    if (statusCode && !this.config.errorCodes.includes(statusCode)) {
      // Если код не в списке ошибок, не считаем его
      return;
    }

    this.failures.push(now);

    if (this.state === CircuitState.HALF_OPEN) {
      // При ошибке в half-open сразу открываем
      this.transitionToOpen();
      return;
    }

    if (this.state === CircuitState.CLOSED) {
      this.cleanOldFailures();

      // Проверяем порог
      if (this.failures.length >= this.config.failureThreshold) {
        this.transitionToOpen();
      }
    }
  }

  /**
   * Получение текущей статистики
   */
  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures.length,
      successes: this.successes,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      openedAt: this.openedAt,
      halfOpenRequests: this.halfOpenRequests
    };
  }

  /**
   * Сброс Circuit Breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.successes = 0;
    this.halfOpenRequests = 0;
    this.openedAt = undefined;
    this.lastFailureAt = undefined;
    this.lastSuccessAt = undefined;

    dbLogger.info(`Circuit breaker ${this.marketplaceId} manually reset`);
  }

  /**
   * Переход в состояние OPEN
   */
  private transitionToOpen(): void {
    const oldState = this.state;
    this.state = CircuitState.OPEN;
    this.openedAt = new Date();
    this.halfOpenRequests = 0;

    dbLogger.warn(`Circuit breaker ${this.marketplaceId} transitioned: ${oldState} → OPEN`, {
      metadata: { failures: this.failures.length }
    });
  }

  /**
   * Переход в состояние HALF-OPEN
   */
  private transitionToHalfOpen(): void {
    const oldState = this.state;
    this.state = CircuitState.HALF_OPEN;
    this.halfOpenRequests = 0;
    this.successes = 0;

    dbLogger.info(`Circuit breaker ${this.marketplaceId} transitioned: ${oldState} → HALF-OPEN`);
  }

  /**
   * Переход в состояние CLOSED
   */
  private transitionToClosed(): void {
    const oldState = this.state;
    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.halfOpenRequests = 0;

    dbLogger.info(`Circuit breaker ${this.marketplaceId} transitioned: ${oldState} → CLOSED`);
  }

  /**
   * Очистка старых ошибок
   */
  private cleanOldFailures(): void {
    const now = Date.now();
    const windowMs = this.config.failureWindowSec * 1000;

    this.failures = this.failures.filter(timestamp => now - timestamp < windowMs);
  }
}

/**
 * Менеджер Circuit Breaker для всех маркетплейсов
 */
export class CircuitBreakerManager {
  private static instance: CircuitBreakerManager;
  private breakers: Map<string, CircuitBreaker> = new Map();
  private configs: Map<string, CircuitBreakerConfig> = new Map();

  // Конфигурация по умолчанию
  private readonly DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    failureWindowSec: 60,
    openTimeoutSec: 30,
    halfOpenMaxRequests: 1,
    successThreshold: 2,
    errorCodes: [500, 502, 503, 504, 408, 429],
    excludeCodes: [400, 401, 403, 404]
  };

  private constructor() {
    this.loadConfigsFromDb();
  }

  static getInstance(): CircuitBreakerManager {
    if (!CircuitBreakerManager.instance) {
      CircuitBreakerManager.instance = new CircuitBreakerManager();
    }
    return CircuitBreakerManager.instance;
  }

  /**
   * Получение Circuit Breaker для маркетплейса
   */
  getBreaker(marketplaceId: string): CircuitBreaker {
    let breaker = this.breakers.get(marketplaceId);

    if (!breaker) {
      const config = this.configs.get(marketplaceId) || this.DEFAULT_CONFIG;
      breaker = new CircuitBreaker(marketplaceId, config);
      this.breakers.set(marketplaceId, breaker);
    }

    return breaker;
  }

  /**
   * Проверка: можно ли выполнять запрос к маркетплейсу
   */
  canExecute(marketplaceId: string): boolean {
    const breaker = this.getBreaker(marketplaceId);
    return breaker.canExecute();
  }

  /**
   * Запись успешного выполнения запроса
   */
  recordSuccess(marketplaceId: string): void {
    const breaker = this.getBreaker(marketplaceId);
    breaker.recordSuccess();
  }

  /**
   * Запись ошибки выполнения запроса
   */
  recordFailure(marketplaceId: string, statusCode?: number): void {
    const breaker = this.getBreaker(marketplaceId);
    breaker.recordFailure(statusCode);
  }

  /**
   * Получение статистики по всем маркетплейсам
   */
  getAllStats(): Map<string, CircuitStats> {
    const stats = new Map<string, CircuitStats>();

    for (const [marketplaceId, breaker] of this.breakers.entries()) {
      stats.set(marketplaceId, breaker.getStats());
    }

    return stats;
  }

  /**
   * Получение статистики по конкретному маркетплейсу
   */
  getStats(marketplaceId: string): CircuitStats | null {
    const breaker = this.breakers.get(marketplaceId);
    return breaker ? breaker.getStats() : null;
  }

  /**
   * Сброс Circuit Breaker
   */
  reset(marketplaceId: string): boolean {
    const breaker = this.breakers.get(marketplaceId);
    if (breaker) {
      breaker.reset();
      return true;
    }
    return false;
  }

  /**
   * Обновление конфигурации
   */
  updateConfig(marketplaceId: string, config: Partial<CircuitBreakerConfig>): void {
    const currentConfig = this.configs.get(marketplaceId) || { ...this.DEFAULT_CONFIG };
    const newConfig = { ...currentConfig, ...config };
    this.configs.set(marketplaceId, newConfig);

    // Сбрасываем breaker при изменении конфигурации
    this.breakers.delete(marketplaceId);

    // Сохраняем в БД
    this.saveConfigToDb(marketplaceId, newConfig);

    dbLogger.info(`Circuit breaker config updated for ${marketplaceId}`);
  }

  /**
   * Загрузка конфигураций из БД
   */
  private loadConfigsFromDb(): void {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT marketplace_id, config_json
        FROM circuit_breaker_configs
        WHERE is_active = 1
      `).all() as any[];

      for (const row of rows) {
        try {
          const config = JSON.parse(row.config_json);
          this.configs.set(row.marketplace_id, {
            ...this.DEFAULT_CONFIG,
            ...config
          });
        } catch (e) {
          dbLogger.error(`Failed to parse CB config for ${row.marketplace_id}`);
        }
      }

      dbLogger.info(`Loaded ${rows.length} circuit breaker configs from database`);
    } catch (error) {
      // Таблица может ещё не существовать
      dbLogger.debug('No circuit breaker configs in database');
    }
  }

  /**
   * Сохранение конфигурации в БД
   */
  private saveConfigToDb(marketplaceId: string, config: CircuitBreakerConfig): void {
    try {
      const db = getDatabase();
      const configJson = JSON.stringify({
        failureThreshold: config.failureThreshold,
        failureWindowSec: config.failureWindowSec,
        openTimeoutSec: config.openTimeoutSec,
        halfOpenMaxRequests: config.halfOpenMaxRequests,
        successThreshold: config.successThreshold,
        errorCodes: config.errorCodes,
        excludeCodes: config.excludeCodes
      });

      db.prepare(`
        INSERT INTO circuit_breaker_configs (marketplace_id, config_json, is_active, updated_at)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(marketplace_id) DO UPDATE SET
          config_json = excluded.config_json,
          updated_at = CURRENT_TIMESTAMP
      `).run(marketplaceId, configJson);
    } catch (error) {
      dbLogger.error('Failed to save CB config', { errorShort: error instanceof Error ? error.message : 'Unknown' });
    }
  }

  /**
   * Запуск фоновой задачи очистки
   */
  startCleanup(): void {
    setInterval(() => {
      // Периодическая запись состояния в БД для мониторинга
      this.saveStatsToDb();
    }, 30 * 1000); // Каждые 30 секунд
  }

  /**
   * Сохранение статистики в БД
   */
  private saveStatsToDb(): void {
    try {
      const db = getDatabase();
      const now = new Date().toISOString();

      for (const [marketplaceId, breaker] of this.breakers.entries()) {
        const stats = breaker.getStats();

        db.prepare(`
          INSERT INTO circuit_breaker_stats (marketplace_id, state, failures, successes, opened_at, last_updated)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(marketplace_id) DO UPDATE SET
            state = excluded.state,
            failures = excluded.failures,
            successes = excluded.successes,
            opened_at = excluded.opened_at,
            last_updated = excluded.last_updated
        `).run(
          marketplaceId,
          stats.state,
          stats.failures,
          stats.successes,
          stats.openedAt?.toISOString() || null,
          now
        );
      }
    } catch (error) {
      dbLogger.error('Failed to save CB stats', { errorShort: error instanceof Error ? error.message : 'Unknown' });
    }
  }
}

// Экспорт единственного экземпляра
export const circuitBreakerManager = CircuitBreakerManager.getInstance();
