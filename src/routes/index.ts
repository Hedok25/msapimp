import { FastifyInstance } from 'fastify';
import { healthController, getQueueStats, getLogs, clearLogs } from '../controllers/health.controller.js';
import { proxyController } from '../controllers/proxy.controller.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.middleware.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /health - проверка состояния сервиса
  fastify.get(
    '/health',
    {
      schema: {
        description: 'Health check endpoint (Liveness/Readiness)',
        tags: ['Health'],
        querystring: {
          type: 'object',
          properties: {
            ready: { type: 'string', enum: ['true'], description: 'Если true, проверяется готовность (Readiness)' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              uptime_sec: { type: 'number' },
              database: { type: 'object' },
              timestamp: { type: 'string' }
            }
          }
        }
      }
    },
    healthController
  );

  // GET /api/v1/queue/stats - статистика очереди
  fastify.get(
    '/queue/stats',
    {
      schema: {
        description: 'Статистика очереди запросов',
        tags: ['Queue'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              queue: { type: 'object' },
              timestamp: { type: 'string' }
            }
          }
        }
      },
      preHandler: [authMiddleware]
    },
    getQueueStats
  );

  // GET /api/v1/logs - просмотр логов
  fastify.get(
    '/logs',
    {
      schema: {
        description: 'Просмотр логов с фильтрацией',
        tags: ['Logs'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            level: { type: 'string', enum: ['info', 'warn', 'error', 'debug'] },
            limit: { type: 'number', default: 100 },
            clientId: { type: 'string' }
          }
        }
      },
      preHandler: [authMiddleware]
    },
    getLogs
  );

  // DELETE /api/v1/logs - очистка старых логов
  fastify.delete(
    '/logs',
    {
      schema: {
        description: 'Очистка логов старше указанной даты',
        tags: ['Logs'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['before'],
          properties: {
            before: { type: 'string', format: 'date-time' }
          }
        }
      },
      preHandler: [adminMiddleware]
    },
    clearLogs
  );
}

export async function proxyRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /{marketplace}/* - проксирование запросов к маркетплейсу
  fastify.all(
    '/:marketplace/*',
    {
      schema: {
        description: 'Проксирование запросов к API маркетплейса',
        tags: ['Proxy'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['marketplace'],
          properties: {
            marketplace: { type: 'string', description: 'ID маркетплейса (ozon, wb, yandex...)' }
          }
        },
        headers: {
          type: 'object',
          properties: {
            'x-proxy-options': {
              type: 'string',
              description: 'Base64-encoded JSON с опциями проксирования'
            }
          }
        }
      },
      preHandler: [authMiddleware]
    },
    proxyController
  );
}
