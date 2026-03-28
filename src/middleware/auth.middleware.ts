import { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/auth.service.js';
import config from '../config/index.js';
import { JwtPayload } from '../types/index.js';

export async function jwtVerifyDecorator(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Проверяем заголовок msapimp-key-api
  const apiKeyHeader = (request.headers as any)['msapimp-key-api'] as string | undefined;
  
  if (!apiKeyHeader) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Missing msapimp-key-api header' });
    throw new Error('Unauthorized');
  }
  
  let token: string;
  if (apiKeyHeader.startsWith('Bearer ')) {
    token = apiKeyHeader.substring(7);
  } else {
    token = apiKeyHeader;
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const [base64Header, base64Payload, signature] = parts;

    // Проверка подписи
    const crypto = await import('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', config.jwt.secret)
      .update(`${base64Header}.${base64Payload}`)
      .digest('base64url');

    if (signature !== expectedSignature) {
      throw new Error('Invalid signature');
    }

    const payload: JwtPayload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString());

    // Проверка истечения
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new Error('Token expired');
    }

    // Проверка отзыва токена (по jti в БД)
    if (authService.isTokenRevoked(payload.jti)) {
      throw new Error('Token revoked');
    }

    // Проверка issuer и audience
    if (payload.iss !== config.jwt.issuer || payload.aud !== config.jwt.audience) {
      throw new Error('Invalid token issuer or audience');
    }

    (request as any).user = payload;
  } catch (error) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Invalid token' });
    throw new Error('Unauthorized');
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await jwtVerifyDecorator(request, reply);
}

export async function adminMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await jwtVerifyDecorator(request, reply);

  const req = request as any;
  if (!req.user || req.user.role !== 'admin') {
    reply.code(403).send({ error: 'Forbidden', message: 'Admin access required' });
    throw new Error('Forbidden');
  }
}
