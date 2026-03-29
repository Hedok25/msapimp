import { FastifyRequest, FastifyReply } from 'fastify';
import { circuitBreakerManager } from '../../services/circuit-breaker.service.js';
import { dbLogger } from '../../logging/index.js';

/**
 * GET /api/v1/admin/circuit-breakers
 * Получение статуса всех Circuit Breaker
 */
export async function getAllCircuitBreakers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const stats = circuitBreakerManager.getAllStats();
    const result = Array.from(stats.entries()).map((entry: [string, any]) => {
      const [marketplaceId, stat] = entry;
      return {
        marketplace_id: marketplaceId,
        state: stat.state,
        failures: stat.failures,
        successes: stat.successes,
        last_failure_at: stat.lastFailureAt?.toISOString() || null,
        last_success_at: stat.lastSuccessAt?.toISOString() || null,
        opened_at: stat.openedAt?.toISOString() || null,
        half_open_requests: stat.halfOpenRequests
      };
    });

    reply.send({
      success: true,
      data: result,
      total: result.length
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to get circuit breakers', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * GET /api/v1/admin/circuit-breakers/:marketplaceId
 * Получение статуса конкретного Circuit Breaker
 */
export async function getCircuitBreaker(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const params = request.params as { marketplaceId: string };
    const { marketplaceId } = params;

    const stats = circuitBreakerManager.getStats(marketplaceId);

    if (!stats) {
      reply.code(404).send({
        error: 'Not Found',
        message: `Circuit breaker for "${marketplaceId}" not found`
      });
      return;
    }

    reply.send({
      success: true,
      data: {
        marketplace_id: marketplaceId,
        state: stats.state,
        failures: stats.failures,
        successes: stats.successes,
        last_failure_at: stats.lastFailureAt?.toISOString() || null,
        last_success_at: stats.lastSuccessAt?.toISOString() || null,
        opened_at: stats.openedAt?.toISOString() || null,
        half_open_requests: stats.halfOpenRequests
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to get circuit breaker', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * POST /api/v1/admin/circuit-breakers/:marketplaceId/reset
 * Сброс Circuit Breaker
 */
export async function resetCircuitBreaker(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const params = request.params as { marketplaceId: string };
    const { marketplaceId } = params;

    const success = circuitBreakerManager.reset(marketplaceId);

    if (!success) {
      reply.code(404).send({
        error: 'Not Found',
        message: `Circuit breaker for "${marketplaceId}" not found`
      });
      return;
    }

    reply.send({
      success: true,
      message: `Circuit breaker for "${marketplaceId}" has been reset`
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to reset circuit breaker', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * PUT /api/v1/admin/circuit-breakers/:marketplaceId/config
 * Обновление конфигурации Circuit Breaker
 */
export async function updateCircuitBreakerConfig(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const params = request.params as { marketplaceId: string };
    const { marketplaceId } = params;

    const body = request.body as {
      failureThreshold?: number;
      failureWindowSec?: number;
      openTimeoutSec?: number;
      halfOpenMaxRequests?: number;
      successThreshold?: number;
      errorCodes?: number[];
      excludeCodes?: number[];
    };

    circuitBreakerManager.updateConfig(marketplaceId, body);

    reply.send({
      success: true,
      message: `Circuit breaker config for "${marketplaceId}" has been updated`
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to update circuit breaker config', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * GET /api/v1/admin/circuit-breakers/stats
 * Общая статистика по Circuit Breakers
 */
export async function getCircuitBreakerStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const stats = circuitBreakerManager.getAllStats();
    
    let closedCount = 0;
    let openCount = 0;
    let halfOpenCount = 0;
    let totalFailures = 0;
    let totalSuccesses = 0;

    for (const [, stat] of stats.entries()) {
      if (stat.state === 'closed') closedCount++;
      else if (stat.state === 'open') openCount++;
      else if (stat.state === 'half-open') halfOpenCount++;
      
      totalFailures += stat.failures;
      totalSuccesses += stat.successes;
    }

    reply.send({
      success: true,
      data: {
        total: stats.size,
        closed: closedCount,
        open: openCount,
        half_open: halfOpenCount,
        total_failures: totalFailures,
        total_successes: totalSuccesses,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to get circuit breaker stats', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}
