import { getDatabase } from '../db/index.js';
import { dbLogger } from '../logging/index.js';

/**
 * Сервис для отслеживания и алертов при превышениях rate limits
 */
export class RateLimitAlertService {
  private static instance: RateLimitAlertService;
  
  // Счётчик превышений по клиентам (для алертов)
  private violationCounts: Map<string, { count: number; windowStart: number }> = new Map();
  
  // Порог для алерта (превышений за час)
  private readonly ALERT_THRESHOLD = 10;
  private readonly ALERT_WINDOW_MS = 60 * 60 * 1000; // 1 час
  
  private constructor() {}
  
  static getInstance(): RateLimitAlertService {
    if (!RateLimitAlertService.instance) {
      RateLimitAlertService.instance = new RateLimitAlertService();
    }
    return RateLimitAlertService.instance;
  }
  
  /**
   * Запись превышения лимита
   */
  async recordViolation(params: {
    clientId: string;
    level: string;
    key: string;
    limit: number;
    count: number;
  }): Promise<void> {
    const { clientId, level, key, limit, count } = params;
    const now = Date.now();
    
    // Обновляем счётчик превышений для клиента
    const clientViolations = this.violationCounts.get(clientId);
    
    if (!clientViolations || now - clientViolations.windowStart > this.ALERT_WINDOW_MS) {
      // Новое окно
      this.violationCounts.set(clientId, {
        count: 1,
        windowStart: now
      });
    } else {
      // То же окно, увеличиваем счётчик
      clientViolations.count++;
    }
    
    // Проверяем порог для алерта
    const currentViolations = this.violationCounts.get(clientId);
    if (currentViolations && currentViolations.count >= this.ALERT_THRESHOLD) {
      await this.sendAlert(clientId, currentViolations.count);
      // Сбрасываем счётчик после алерта
      this.violationCounts.set(clientId, {
        count: 0,
        windowStart: now
      });
    }
    
    // Сохраняем в БД для истории
    await this.saveViolationToDb(params);
  }
  
  /**
   * Отправка алерта
   */
  private async sendAlert(clientId: string, violationCount: number): Promise<void> {
    const message = `⚠️ ALERT: Client ${clientId} exceeded rate limit ${violationCount} times in the last hour`;
    
    dbLogger.warn(message, {
      metadata: {
        clientId,
        violationCount,
        threshold: this.ALERT_THRESHOLD,
        windowMs: this.ALERT_WINDOW_MS
      }
    });
    
    // Здесь можно добавить отправку уведомлений:
    // - Email администратору
    // - Slack webhook
    // - Telegram bot
    // - Webhook
    
    // Пример webhook:
    // await this.sendWebhook({ clientId, violationCount });
  }
  
  /**
   * Сохранение превышения в БД
   */
  private async saveViolationToDb(params: {
    clientId: string;
    level: string;
    key: string;
    limit: number;
    count: number;
  }): Promise<void> {
    const db = getDatabase();
    const { clientId, level, key, limit, count } = params;
    
    try {
      db.prepare(`
        INSERT INTO audit_logs (admin_id, action, resource_type, resource_id, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        'system',
        'RATE_LIMIT_VIOLATION',
        level,
        clientId,
        JSON.stringify({
          level,
          key,
          limit,
          count,
          timestamp: new Date().toISOString()
        })
      );
    } catch (error) {
      dbLogger.error('Failed to save violation to DB', {
        errorShort: error instanceof Error ? error.message : 'Unknown'
      });
    }
  }
  
  /**
   * Получение статистики превышений по клиенту
   */
  getClientViolations(clientId: string): { count: number; windowStart: Date } | null {
    const violations = this.violationCounts.get(clientId);
    if (!violations) {
      return null;
    }
    
    return {
      count: violations.count,
      windowStart: new Date(violations.windowStart)
    };
  }
  
  /**
   * Сброс счётчика превышений
   */
  resetClientViolations(clientId: string): void {
    this.violationCounts.delete(clientId);
  }
  
  /**
   * Запуск фоновой задачи очистки старых алертов
   */
  startCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      
      for (const [clientId, data] of this.violationCounts.entries()) {
        if (now - data.windowStart > this.ALERT_WINDOW_MS) {
          this.violationCounts.delete(clientId);
        }
      }
    }, 60 * 1000); // Каждую минуту
  }
}

// Экспорт единственного экземпляра
export const rateLimitAlertService = RateLimitAlertService.getInstance();
