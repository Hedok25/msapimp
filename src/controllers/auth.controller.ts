import { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/auth.service.js';
import { loginSchema, refreshTokenSchema } from '../validation/schemas.js';
import { dbLogger } from '../logging/index.js';

export async function loginController(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const body = loginSchema.parse(request.body);
    const { email, password } = body;

    const tokens = await authService.login(email, password);

    dbLogger.info('User logged in', {
      clientId: email,
      action: 'login',
      metadata: { email }
    });

    reply.send({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      token_type: 'Bearer'
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Invalid credentials') {
        reply.code(401).send({ error: 'Unauthorized', message: 'Invalid email or password' });
      } else {
        reply.code(400).send({ error: 'Bad Request', message: error.message });
      }
    } else {
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  }
}

export async function refreshController(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const body = refreshTokenSchema.parse(request.body);
    const tokens = await authService.refreshToken(body.refresh_token);

    reply.send({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      token_type: 'Bearer'
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Invalid or expired refresh token') {
        reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired refresh token' });
      } else {
        reply.code(400).send({ error: 'Bad Request', message: error.message });
      }
    } else {
      reply.code(500).send({ error: 'Internal Server Error' });
    }
  }
}

export async function logoutController(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const body = refreshTokenSchema.parse(request.body);
    await authService.logout(body.refresh_token);

    reply.send({ message: 'Logged out successfully' });
  } catch (error) {
    reply.code(500).send({ error: 'Internal Server Error' });
  }
}

export async function meController(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const req = request as any;
    const user = req.user;
    if (!user) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const client = authService.getClientByClientId(user.sub);

    reply.send({
      client_id: user.sub,
      role: user.role,
      rate_tier: user.rate_tier,
      scope: user.scope,
      is_active: client ? true : false
    });
  } catch (error) {
    reply.code(500).send({ error: 'Internal Server Error' });
  }
}
