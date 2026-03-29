import { FastifyInstance } from 'fastify';
import {
  getAllCircuitBreakers,
  getCircuitBreaker,
  resetCircuitBreaker,
  updateCircuitBreakerConfig,
  getCircuitBreakerStats
} from '../../controllers/admin/circuit-breaker.controller.js';
import { adminMiddleware } from '../../middleware/auth.middleware.js';

export async function adminCircuitBreakerRoutes(fastify: FastifyInstance): Promise<void> {
  
  // GET /api/v1/admin/circuit-breakers - Все Circuit Breakers
  fastify.get(
    '/circuit-breakers',
    {
      schema: {
        description: 'Получение статуса всех Circuit Breaker',
        tags: ['Admin', 'Circuit Breakers'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array' },
              total: { type: 'number' }
            }
          }
        }
      },
      preHandler: [adminMiddleware]
    },
    getAllCircuitBreakers
  );

  // GET /api/v1/admin/circuit-breakers/stats - Статистика
  fastify.get(
    '/circuit-breakers/stats',
    {
      schema: {
        description: 'Общая статистика по Circuit Breakers',
        tags: ['Admin', 'Circuit Breakers'],
        security: [{ bearerAuth: [] }]
      },
      preHandler: [adminMiddleware]
    },
    getCircuitBreakerStats
  );

  // GET /api/v1/admin/circuit-breakers/:marketplaceId - Статус конкретного CB
  fastify.get(
    '/circuit-breakers/:marketplaceId',
    {
      schema: {
        description: 'Получение статуса конкретного Circuit Breaker',
        tags: ['Admin', 'Circuit Breakers'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['marketplaceId'],
          properties: {
            marketplaceId: { type: 'string', description: 'ID маркетплейса' }
          }
        }
      },
      preHandler: [adminMiddleware]
    },
    getCircuitBreaker
  );

  // POST /api/v1/admin/circuit-breakers/:marketplaceId/reset - Сброс CB
  fastify.post(
    '/circuit-breakers/:marketplaceId/reset',
    {
      schema: {
        description: 'Сброс Circuit Breaker',
        tags: ['Admin', 'Circuit Breakers'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['marketplaceId'],
          properties: {
            marketplaceId: { type: 'string' }
          }
        }
      },
      preHandler: [adminMiddleware]
    },
    resetCircuitBreaker
  );

  // PUT /api/v1/admin/circuit-breakers/:marketplaceId/config - Обновление конфигурации
  fastify.put(
    '/circuit-breakers/:marketplaceId/config',
    {
      schema: {
        description: 'Обновление конфигурации Circuit Breaker',
        tags: ['Admin', 'Circuit Breakers'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['marketplaceId'],
          properties: {
            marketplaceId: { type: 'string' }
          }
        },
        body: {
          type: 'object',
          properties: {
            failureThreshold: { type: 'number' },
            failureWindowSec: { type: 'number' },
            openTimeoutSec: { type: 'number' },
            halfOpenMaxRequests: { type: 'number' },
            successThreshold: { type: 'number' },
            errorCodes: { type: 'array', items: { type: 'number' } },
            excludeCodes: { type: 'array', items: { type: 'number' } }
          }
        }
      },
      preHandler: [adminMiddleware]
    },
    updateCircuitBreakerConfig
  );
}
