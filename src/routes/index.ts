import { FastifyInstance } from 'fastify';
import { healthController, getQueueStats, getLogs, clearLogs } from '../controllers/health.controller.js';
import { proxyController } from '../controllers/proxy.controller.js';
import { getQueueStatsController, getRequestController, deleteRequestController, clearQueueController } from '../controllers/queue.controller.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.middleware.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.middleware.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  // Тестовый маршрут
  fastify.get('/queue/test', () => {
    console.log('✅ TEST ROUTE CALLED!');
    return { message: 'test route works', ts: Date.now() };
  });

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

  // GET /api/v1/queue - список запросов очереди
  fastify.get(
    '/queue',
    {
      schema: {
        description: 'Список запросов в очереди',
        tags: ['Queue'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['accepted', 'processing', 'completed', 'failed', 'retrying', 'dead_letter'] },
            limit: { type: 'number', default: 100 },
            offset: { type: 'number', default: 0 }
          }
        },
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
      preHandler: [authMiddleware]
    },
    async (request, reply) => {
      const { status, limit = 100, offset = 0 } = request.query as { status?: string; limit?: number; offset?: number };
      const db = await import('../db/index.js');
      const database = db.getDatabase();

      let query = 'SELECT * FROM requests';
      let countQuery = 'SELECT COUNT(*) as total FROM requests';

      if (status) {
        query += ' WHERE status = ?';
        countQuery += ' WHERE status = ?';
      }

      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

      const countStmt = database.prepare(countQuery);
      const total = (status ? countStmt.get(status) : countStmt.get()) as { total: number };

      const stmt = database.prepare(query);
      const rows = status ? stmt.all(status, limit, offset) : stmt.all(limit, offset);

      reply.send({
        success: true,
        data: rows,
        total: total.total
      });
    }
  );

  // GET /api/v1/queue/:uuid - получение запроса по UUID
  fastify.get(
    '/queue/:uuid',
    {
      schema: {
        description: 'Получение запроса по UUID',
        tags: ['Queue'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['uuid'],
          properties: {
            uuid: { type: 'string', description: 'UUID запроса' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object',additionalProperties: true }
            }
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' }
            }
          }
        }
      },
      preHandler: [authMiddleware]
    },
    getRequestController
  );

  // DELETE /api/v1/queue/:uuid - удаление запроса из очереди
  fastify.delete(
    '/queue/:uuid',
    {
      schema: {
        description: 'Удаление запроса из очереди',
        tags: ['Queue'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['uuid'],
          properties: {
            uuid: { type: 'string', description: 'UUID запроса' }
          }
        }
      },
      preHandler: [authMiddleware]
    },
    deleteRequestController
  );

  // POST /api/v1/queue/clear - очистка завершенных запросов
  fastify.post(
    '/queue/clear',
    {
      schema: {
        description: 'Очистка завершенных запросов',
        tags: ['Queue'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            olderThan: { type: 'string', format: 'date-time', description: 'Очистить запросы, завершенные до этой даты' }
          }
        }
      },
      preHandler: [adminMiddleware]
    },
    clearQueueController
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
            },
            'x-store-id': {
              type: 'string',
              description: 'ID магазина (stores.id)'
            }
          }
        }
      },
      preHandler: [authMiddleware, rateLimitMiddleware]
    },
    proxyController
  );
}
