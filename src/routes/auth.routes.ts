import { FastifyInstance } from 'fastify';
import { loginController, refreshController, logoutController, meController } from '../controllers/auth.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /auth/login - получение токенов
  fastify.post(
    '/login',
    {
      schema: {
        description: 'Получение пары access/refresh токенов',
        tags: ['Authentication'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              access_token: { type: 'string' },
              refresh_token: { type: 'string' },
              expires_in: { type: 'number' },
              token_type: { type: 'string' }
            }
          }
        }
      }
    },
    loginController
  );

  // POST /auth/refresh - обновление access токена
  fastify.post(
    '/refresh',
    {
      schema: {
        description: 'Обновление access токена через refresh token',
        tags: ['Authentication'],
        body: {
          type: 'object',
          required: ['refresh_token'],
          properties: {
            refresh_token: { type: 'string', format: 'uuid' }
          }
        }
      }
    },
    refreshController
  );

  // POST /auth/logout - отзыв refresh токена
  fastify.post(
    '/logout',
    {
      schema: {
        description: 'Выход из системы (отзыв refresh токена)',
        tags: ['Authentication'],
        body: {
          type: 'object',
          required: ['refresh_token'],
          properties: {
            refresh_token: { type: 'string', format: 'uuid' }
          }
        }
      }
    },
    logoutController
  );

  // GET /auth/me - информация о текущем пользователе
  fastify.get(
    '/me',
    {
      schema: {
        description: 'Получение информации о текущем пользователе',
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              client_id: { type: 'string' },
              role: { type: 'string' },
              rate_tier: { type: 'string' },
              scope: { type: 'array', items: { type: 'string' } },
              is_active: { type: 'boolean' }
            }
          }
        }
      },
      preHandler: [authMiddleware]
    },
    meController
  );
}
