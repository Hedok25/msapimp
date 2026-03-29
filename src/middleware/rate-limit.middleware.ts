import { FastifyRequest, FastifyReply } from 'fastify';
import { rateLimitService, RateLimitResult } from '../services/rate-limit.service.js';
import { getDatabase } from '../db/index.js';
import { dbLogger } from '../logging/index.js';

/**
 * Middleware для проверки Rate Limiting
 * Проверяет все 6 уровней иерархии
 */
export async function rateLimitMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    // Получаем IP адрес
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    
    // Получаем информацию о клиенте из JWT (добавляется authMiddleware)
    const req = request as any;
    const user = req.user;
    
    if (!user) {
      // Если нет пользователя, пропускаем (авторизация уже проверена)
      return;
    }
    
    const clientId = user.sub;
    const rateTier = user.rate_tier || 'basic';
    
    // Получаем marketplace_id из пути
    const params = request.params as any;
    const marketplaceId = params.marketplace || 'unknown';
    
    // Определяем store_id
    let storeId: number | undefined;
    const storeIdHeader = (request.headers['x-store-id'] as string);
    if (storeIdHeader) {
      storeId = parseInt(storeIdHeader, 10);
    }
    
    // Если store_id не указан, пытаемся определить по токену МП
    if (!storeId) {
      storeId = await getStoreIdFromToken(clientId, marketplaceId);
    }
    
    // Определяем token_id (если есть токен МП)
    let tokenId: number | undefined;
    if (storeId) {
      tokenId = await getTokenId(storeId, marketplaceId);
    }
    
    // Получаем endpoint из пути
    const endpoint = request.url.split('?')[0];
    
    // Проверяем все уровни rate limiting
    const result = await rateLimitService.checkAllLimits({
      ip,
      clientId,
      rateTier,
      marketplaceId,
      storeId,
      tokenId,
      endpoint
    });
    
    // Если лимит превышен, возвращаем 429
    if (result && !result.allowed) {
      await sendRateLimitResponse(reply, result);
      return;
    }
    
    // Добавляем заголовки с информацией о лимитах
    if (result) {
      addRateLimitHeaders(reply, result);
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Rate limit middleware error', { errorShort: errorMessage });
    // Не блокируем запрос при ошибке rate limiting
  }
}

/**
 * Отправка ответа 429 Too Many Requests
 */
async function sendRateLimitResponse(reply: FastifyReply, result: RateLimitResult): Promise<void> {
  const retryAfter = result.retryAfter || 60;
  const resetDate = new Date(result.reset * 1000);
  
  // Заголовки
  reply.code(429);
  reply.header('Retry-After', retryAfter);
  reply.header('X-RateLimit-Limit', result.limit);
  reply.header('X-RateLimit-Remaining', 0);
  reply.header('X-RateLimit-Reset', result.reset);
  reply.header('X-RateLimit-Level', result.level);
  
  // Тело ответа
  const response = {
    error: {
      status: false,
      code: 'RATE_LIMIT_EXCEEDED',
      message: getRateLimitMessage(result.level, result.key),
      detail: getRateLimitDetail(result),
      retry_after: retryAfter,
      limit: result.limit,
      remaining: 0,
      reset_at: resetDate.toISOString()
    },
    services_info: {
      status: false,
      created_at: new Date().toISOString(),
      request_id: generateRequestId()
    }
  };
  
  reply.send(response);
}

/**
 * Добавление заголовков Rate Limit в успешный ответ
 */
function addRateLimitHeaders(reply: FastifyReply, result: RateLimitResult): void {
  reply.header('X-RateLimit-Limit', result.limit);
  reply.header('X-RateLimit-Remaining', result.remaining);
  reply.header('X-RateLimit-Reset', result.reset);
  reply.header('X-RateLimit-Level', result.level);
}

/**
 * Получение человеко-читаемого сообщения для каждого уровня
 */
function getRateLimitMessage(level: string, key: string): string {
  const messages: Record<string, string> = {
    global: 'Global rate limit exceeded. Please slow down.',
    client: `Client rate limit exceeded. Consider upgrading your tariff.`,
    marketplace: `Marketplace rate limit exceeded for ${key.split(':')[1] || 'unknown'}.`,
    store: `Store rate limit exceeded.`,
    token: `Marketplace token rate limit exceeded.`,
    endpoint: `Endpoint rate limit exceeded.`
  };
  
  let message = messages[level] || 'Rate limit exceeded';
  
  // Добавляем информацию о тарифе для client уровня
  if (level === 'client') {
    message += ' Upgrade to premium for higher limits.';
  }
  
  return message;
}

/**
 * Получение детальной информации о превышении
 */
function getRateLimitDetail(result: RateLimitResult): any {
  const detail: any = {
    level: result.level,
    key: result.key
  };
  
  // Парсим ключ для получения дополнительной информации
  const parts = result.key.split(':');
  
  switch (result.level) {
    case 'store':
      detail.store_id = parts[1];
      break;
    case 'token':
      detail.token_id = parts[1];
      break;
    case 'marketplace':
      detail.marketplace_id = parts[2];
      break;
    case 'endpoint':
      detail.store_id = parts[2];
      detail.endpoint = parts.slice(3).join(':');
      break;
  }
  
  return detail;
}

/**
 * Генерация уникального ID запроса
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Получение store_id из токена МП
 */
async function getStoreIdFromToken(clientId: string, marketplaceId: string): Promise<number | undefined> {
  try {
    const db = getDatabase();
    
    // Ищем активный магазин клиента для данного маркетплейса
    const store = db.prepare(`
      SELECT id FROM stores
      WHERE client_id = ? AND marketplace_id = ? AND is_active = 1
      LIMIT 1
    `).get(clientId, marketplaceId) as any;
    
    return store?.id;
  } catch (error) {
    dbLogger.error('Failed to get store from token', { errorShort: error instanceof Error ? error.message : 'Unknown' });
    return undefined;
  }
}

/**
 * Получение token_id для магазина
 */
async function getTokenId(storeId: number, marketplaceId: string): Promise<number | undefined> {
  try {
    const db = getDatabase();
    
    // Ищем активный токен для магазина
    const token = db.prepare(`
      SELECT id FROM mp_tokens
      WHERE store_id = ? AND marketplace_id = ? AND is_active = 1 AND is_primary = 1
      LIMIT 1
    `).get(storeId, marketplaceId) as any;
    
    return token?.id;
  } catch (error) {
    dbLogger.error('Failed to get token', { errorShort: error instanceof Error ? error.message : 'Unknown' });
    return undefined;
  }
}
