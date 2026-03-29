import { FastifyInstance } from 'fastify';
import {
  getGroupStatus,
  getGroupResults,
  getGroupRequests
} from '../controllers/pagination.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

export async function paginationRoutes(fastify: FastifyInstance): Promise<void> {
  
  // GET /api/v1/pagination/groups/:groupId - Статус группы
  fastify.get(
    '/pagination/groups/:groupId',
    {
      schema: {
        description: 'Получение статуса группы запросов на пагинацию',
        tags: ['Pagination'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['groupId'],
          properties: {
            groupId: { type: 'string', description: 'ID группы запросов' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  request_group_id: { type: 'string' },
                  status: { type: 'string' },
                  pagination: { type: 'object' }
                }
              }
            }
          }
        }
      },
      preHandler: [authMiddleware]
    },
    getGroupStatus
  );

  // GET /api/v1/pagination/groups/:groupId/results - Результаты группы
  fastify.get(
    '/pagination/groups/:groupId/results',
    {
      schema: {
        description: 'Получение агрегированных результатов группы запросов',
        tags: ['Pagination'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['groupId'],
          properties: {
            groupId: { type: 'string' }
          }
        }
      },
      preHandler: [authMiddleware]
    },
    getGroupResults
  );

  // GET /api/v1/pagination/groups/:groupId/requests - Список запросов
  fastify.get(
    '/pagination/groups/:groupId/requests',
    {
      schema: {
        description: 'Получение списка всех запросов в группе',
        tags: ['Pagination'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['groupId'],
          properties: {
            groupId: { type: 'string' }
          }
        }
      },
      preHandler: [authMiddleware]
    },
    getGroupRequests
  );
}
