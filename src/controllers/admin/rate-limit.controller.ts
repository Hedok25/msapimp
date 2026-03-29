import { FastifyRequest, FastifyReply } from 'fastify';
import { rateLimitService } from '../../services/rate-limit.service.js';
import { getDatabase } from '../../db/index.js';
import { dbLogger } from '../../logging/index.js';

/**
 * GET /api/v1/admin/rate-limits
 * Получение всех лимитов системы
 */
export async function getAllRateLimits(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const db = getDatabase();
    
    const rows = db.prepare(`
      SELECT id, level, key, requests, window_sec, burst, concurrent, is_active, created_at, updated_at
      FROM rate_limit_configs
      ORDER BY level, key
    `).all() as any[];
    
    reply.send({
      success: true,
      data: rows,
      total: rows.length
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to get rate limits', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * GET /api/v1/admin/rate-limits/:clientId
 * Получение лимитов конкретного клиента
 */
export async function getClientRateLimits(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const params = request.params as { clientId: string };
    const { clientId } = params;
    
    const db = getDatabase();
    
    const rows = db.prepare(`
      SELECT id, level, key, requests, window_sec, burst, concurrent, is_active, created_at, updated_at
      FROM rate_limit_configs
      WHERE key LIKE ?
      ORDER BY level, key
    `).all(`%${clientId}%`) as any[];
    
    // Получаем информацию о клиенте
    const client = db.prepare(`
      SELECT client_id, email, role, rate_tier, is_active, created_at
      FROM clients
      WHERE client_id = ?
    `).get(clientId) as any;
    
    if (!client) {
      reply.code(404).send({
        error: 'Not Found',
        message: `Client ${clientId} not found`
      });
      return;
    }
    
    reply.send({
      success: true,
      data: {
        client,
        limits: rows
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to get client rate limits', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * GET /api/v1/admin/rate-limits/usage
 * Текущее использование лимитов
 */
export async function getRateLimitsUsage(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const db = getDatabase();
    
    const now = new Date().toISOString();
    
    const counters = db.prepare(`
      SELECT key, count, window_start, window_end, last_updated
      FROM rate_limit_counters
      WHERE window_end > ?
      ORDER BY count DESC
      LIMIT 100
    `).all(now) as any[];
    
    reply.send({
      success: true,
      data: counters,
      total: counters.length,
      timestamp: now
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to get rate limits usage', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * POST /api/v1/admin/rate-limits/override
 * Переопределение лимита
 */
export async function overrideRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const body = request.body as {
      level: string;
      key: string;
      requests: number;
      window_sec: number;
      burst?: number;
      concurrent?: number;
    };
    
    const { level, key, requests, window_sec, burst, concurrent } = body;
    
    if (!level || !key || !requests || !window_sec) {
      reply.code(400).send({
        error: 'Bad Request',
        message: 'Missing required fields: level, key, requests, window_sec'
      });
      return;
    }
    
    await rateLimitService.setCustomLimit({
      level: level as any,
      key,
      requests,
      window_sec,
      burst,
      concurrent
    });
    
    reply.send({
      success: true,
      message: `Rate limit override set for ${level}:${key}`
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to override rate limit', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * POST /api/v1/admin/rate-limits/reset
 * Сброс счётчика
 */
export async function resetRateLimitCounter(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const body = request.body as { key: string };
    const { key } = body;
    
    if (!key) {
      reply.code(400).send({
        error: 'Bad Request',
        message: 'Missing required field: key'
      });
      return;
    }
    
    await rateLimitService.resetCounter(key);
    
    reply.send({
      success: true,
      message: `Rate limit counter reset for ${key}`
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to reset rate limit counter', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * GET /api/v1/admin/rate-limits/violations
 * Лог превышений лимитов (429 ошибки)
 */
export async function getRateLimitViolations(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const query = request.query as { limit?: number; clientId?: string; level?: string };
    const limit = query.limit || 100;
    const clientId = query.clientId;
    const level = query.level;
    
    const db = getDatabase();
    
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    
    if (clientId) {
      whereClause += ' AND key LIKE ?';
      params.push(`%${clientId}%`);
    }
    
    if (level) {
      whereClause += ' AND level = ?';
      params.push(level);
    }
    
    // Получаем последние превышения из rate_limit_counters
    // (в реальном проекте нужно создать отдельную таблицу audit_logs для 429)
    const rows = db.prepare(`
      SELECT key, count, window_start, window_end, last_updated
      FROM rate_limit_counters
      ${whereClause}
      ORDER BY last_updated DESC
      LIMIT ?
    `).all(...params, limit) as any[];
    
    reply.send({
      success: true,
      data: rows,
      total: rows.length
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to get rate limit violations', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * GET /api/v1/admin/rate-limits/stats
 * Статистика по лимитам
 */
export async function getRateLimitStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const db = getDatabase();
    
    // Общее количество конфигураций
    const totalConfigs = db.prepare('SELECT COUNT(*) as count FROM rate_limit_configs').get() as any;
    
    // Активные конфигурации по уровням
    const byLevel = db.prepare(`
      SELECT level, COUNT(*) as count, SUM(requests) as total_requests
      FROM rate_limit_configs
      WHERE is_active = 1
      GROUP BY level
    `).all() as any[];
    
    // Текущие активные счётчики
    const now = new Date().toISOString();
    const activeCounters = db.prepare(`
      SELECT COUNT(*) as count
      FROM rate_limit_counters
      WHERE window_end > ?
    `).get(now) as any;
    
    reply.send({
      success: true,
      data: {
        totalConfigs: totalConfigs.count,
        byLevel,
        activeCounters: activeCounters.count,
        timestamp: now
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to get rate limit stats', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}
