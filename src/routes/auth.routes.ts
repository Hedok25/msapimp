import { FastifyInstance } from 'fastify';
import { loginController, logoutController, meController } from '../controllers/auth.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /auth/login - получение токена
  fastify.post(
    '/login',
    {
      schema: {
        description: 'Получение access токена',
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
              expires_in: { type: 'number' },
              token_type: { type: 'string' }
            }
          }
        }
      }
    },
    loginController
  );

  // POST /auth/logout - отзыв токена
  fastify.post(
    '/logout',
    {
      schema: {
        description: 'Выход из системы (отзыв access токена)',
        tags: ['Authentication'],
        body: {
          type: 'object',
          required: ['access_token'],
          properties: {
            access_token: { type: 'string' }
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
