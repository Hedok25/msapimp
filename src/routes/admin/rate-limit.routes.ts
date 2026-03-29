import { FastifyInstance } from 'fastify';
import {
  getAllRateLimits,
  getClientRateLimits,
  getRateLimitsUsage,
  overrideRateLimit,
  resetRateLimitCounter,
  getRateLimitViolations,
  getRateLimitStats
} from '../../controllers/admin/rate-limit.controller.js';
import { adminMiddleware } from '../../middleware/auth.middleware.js';

export async function adminRateLimitRoutes(fastify: FastifyInstance): Promise<void> {
  
  // GET /api/v1/admin/rate-limits - Все лимиты системы
  fastify.get(
    '/rate-limits',
    {
      schema: {
        description: 'Получение всех лимитов системы',
        tags: ['Admin', 'Rate Limits'],
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
    getAllRateLimits
  );

  // GET /api/v1/admin/rate-limits/:clientId - Лимиты клиента
  fastify.get(
    '/rate-limits/:clientId',
    {
      schema: {
        description: 'Получение лимитов конкретного клиента',
        tags: ['Admin', 'Rate Limits'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['clientId'],
          properties: {
            clientId: { type: 'string', description: 'ID клиента' }
          }
        }
      },
      preHandler: [adminMiddleware]
    },
    getClientRateLimits
  );

  // GET /api/v1/admin/rate-limits/usage - Использование лимитов
  fastify.get(
    '/rate-limits/usage',
    {
      schema: {
        description: 'Текущее использование лимитов',
        tags: ['Admin', 'Rate Limits'],
        security: [{ bearerAuth: [] }]
      },
      preHandler: [adminMiddleware]
    },
    getRateLimitsUsage
  );

  // GET /api/v1/admin/rate-limits/violations - Лог превышений
  fastify.get(
    '/rate-limits/violations',
    {
      schema: {
        description: 'Лог превышений лимитов (429 ошибки)',
        tags: ['Admin', 'Rate Limits'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'number', default: 100 },
            clientId: { type: 'string' },
            level: { type: 'string' }
          }
        }
      },
      preHandler: [adminMiddleware]
    },
    getRateLimitViolations
  );

  // GET /api/v1/admin/rate-limits/stats - Статистика
  fastify.get(
    '/rate-limits/stats',
    {
      schema: {
        description: 'Статистика по лимитам',
        tags: ['Admin', 'Rate Limits'],
        security: [{ bearerAuth: [] }]
      },
      preHandler: [adminMiddleware]
    },
    getRateLimitStats
  );

  // POST /api/v1/admin/rate-limits/override - Переопределение лимита
  fastify.post(
    '/rate-limits/override',
    {
      schema: {
        description: 'Переопределение лимита',
        tags: ['Admin', 'Rate Limits'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['level', 'key', 'requests', 'window_sec'],
          properties: {
            level: { type: 'string', enum: ['client', 'marketplace', 'store', 'token', 'endpoint'] },
            key: { type: 'string' },
            requests: { type: 'number' },
            window_sec: { type: 'number' },
            burst: { type: 'number' },
            concurrent: { type: 'number' }
          }
        }
      },
      preHandler: [adminMiddleware]
    },
    overrideRateLimit
  );

  // POST /api/v1/admin/rate-limits/reset - Сброс счётчика
  fastify.post(
    '/rate-limits/reset',
    {
      schema: {
        description: 'Сброс счётчика лимита',
        tags: ['Admin', 'Rate Limits'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['key'],
          properties: {
            key: { type: 'string' }
          }
        }
      },
      preHandler: [adminMiddleware]
    },
    resetRateLimitCounter
  );
}
