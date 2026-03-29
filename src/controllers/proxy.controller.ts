import { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { dbLogger } from '../logging/index.js';
import { ProxyOptions, PaginatedResponse } from '../types/index.js';
import { queueService } from '../services/queue.service.js';
import { circuitBreakerManager } from '../services/circuit-breaker.service.js';
import { paginationService } from '../services/pagination.service.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Загружаем конфиг marketplaces
const marketplacesConfig = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../config/marketplaces.json'), 'utf-8')
);

export interface ProxyRequestParams {
  marketplace: string;
  path: string[];
}

/**
 * Прокси-контроллер для обработки запросов к маркетплейсам
 * Добавляет запрос в очередь и возвращает UUID для отслеживания
 */
export async function proxyController(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = request.params as unknown as ProxyRequestParams & { '*': string };
  const marketplace = params.marketplace;

  // Получаем путь из wildcard (*) или из path
  const pathRaw = params['*'] || params.path || '';
  const pathString = Array.isArray(pathRaw) ? pathRaw.join('/') : pathRaw;

  const req = request as any;
  const requestId = uuidv4();
  const clientId = req.user?.sub || 'anonymous';

  try {
    // Проверка Circuit Breaker
    if (!circuitBreakerManager.canExecute(marketplace)) {
      const stats = circuitBreakerManager.getStats(marketplace);
      const retryAfter = stats?.openedAt
        ? Math.ceil((stats.openedAt.getTime() + 30000 - Date.now()) / 1000)
        : 30;

      dbLogger.warn(`Circuit breaker OPEN for ${marketplace}`, {
        requestId,
        clientId,
        action: 'circuit_breaker_open'
      });

      reply.code(503).header('Retry-After', retryAfter).send({
        error: 'Service Unavailable',
        message: `Circuit breaker is OPEN for marketplace "${marketplace}". Try again later.`,
        code: 'CIRCUIT_BREAKER_OPEN',
        retry_after: retryAfter,
        marketplace
      });
      return;
    }

    // Парсинг msapimp-options (заголовок с опциями прокси)
    let proxyOptions: Partial<ProxyOptions> = {};
    const optionsHeader = request.headers['msapimp-options'] as string;

    if (optionsHeader) {
      try {
        const decoded = Buffer.from(optionsHeader, 'base64').toString('utf-8');
        if (decoded.length > 1024) {
          reply.code(413).send({ 
            error: 'Payload Too Large', 
            message: 'msapimp-options exceeds 1KB limit' 
          });
          return;
        }
        proxyOptions = JSON.parse(decoded);
      } catch (error) {
        reply.code(400).send({ 
          error: 'Bad Request', 
          message: 'Invalid msapimp-options format. Must be Base64-encoded JSON.' 
        });
        return;
      }
    }

    // Проверка на пагинацию (из msapimp-options.paginate, по умолчанию true)
    const paginateAll = proxyOptions.paginate !== false;

    if (paginateAll) {
      // Обработка пагинации
      return await handlePagination(request, reply, marketplace, pathString, clientId, proxyOptions);
    }

    // Получение конфигурации маркетплейса
    const marketplaceConfig = await getMarketplaceConfig(marketplace);

    // Формирование URL запроса к МП (с query параметрами)
    const targetPath = pathString.startsWith('/') ? pathString : '/' + pathString;
    const targetUrl = marketplaceConfig
      ? new URL(targetPath, marketplaceConfig.baseUrl)
      : null;

    // Добавляем query параметры из запроса
    const originalUrl = new URL(request.url, 'http://localhost');
    for (const [key, value] of originalUrl.searchParams) {
      targetUrl?.searchParams.append(key, value);
    }

    const targetUrlString = targetUrl?.toString() || `unknown:///${marketplace}${targetPath}`;

    // Логирование запроса с реальным URL
    dbLogger.info('Proxy request received', {
      requestId,
      clientId,
      action: 'proxy_request',
      metadata: {
        marketplace,
        path: pathString,
        method: request.method,
        url: request.url,
        targetUrl: targetUrlString
      }
    });

    if (!marketplaceConfig) {
      dbLogger.error('Marketplace not found', {
        requestId,
        clientId,
        action: 'proxy_failed',
        errorShort: 'HTTP 404',
        errorMessage: `HTTP 404: Marketplace "${marketplace}" not found`,
        metadata: {
          marketplace,
          statusCode: 404,
          method: request.method,
          targetUrl: targetUrlString,
          path: pathString
        }
      });

      reply.code(404).send({ error: 'Not Found', message: `Marketplace "${marketplace}" not found` });
      return;
    }

    // targetUrl гарантированно не null после проверки marketplaceConfig
    const finalTargetUrl = targetUrl!;

    // Фильтрация заголовков (убираем msapimp-key-api и служебные)
    const filteredHeaders = filterHeaders(request.headers);

    const bodyString = request.body ? JSON.stringify(request.body) : null;

    // Добавление запроса в очередь
    await queueService.enqueue({
      uuid: requestId,
      client_id: clientId,
      marketplace_id: marketplace,
      method: request.method,
      url: finalTargetUrl.toString(),
      headers: filteredHeaders,
      body: bodyString || undefined,
      priority: proxyOptions.priority || 'normal'
    });

    // Возвращаем клиенту UUID запроса
    reply.code(202).send({
      success: true,
      message: 'Request queued for processing',
      data: {
        request_id: requestId,
        status: 'accepted',
        marketplace,
        url: finalTargetUrl.toString(),
        method: request.method,
        estimated_processing_time: '5-30 seconds'
      }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    dbLogger.error('Proxy request failed', {
      requestId,
      clientId,
      action: 'proxy_failed',
      errorShort: errorMessage,
      errorMessage: errorMessage,
      metadata: { marketplace }
    });

    reply.code(502).send({
      error: 'Bad Gateway',
      message: errorMessage,
      request_id: requestId
    });
  }
}

function getMarketplaceConfig(marketplaceId: string) {
  const mp = marketplacesConfig.marketplaces.find((m: { id: string }) => m.id === marketplaceId);
  return mp || null;
}

function filterHeaders(headers: Record<string, unknown>): Record<string, string> {
  const forbiddenHeaders = ['host', 'content-length', 'connection', 'msapimp-key-api'];
  const filtered: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (!forbiddenHeaders.includes(key.toLowerCase()) && typeof value === 'string') {
      filtered[key] = value;
    }
  }

  return filtered;
}

/**
 * Обработка пагинации запросов к маркетплейсу
 */
async function handlePagination(
  request: FastifyRequest,
  reply: FastifyReply,
  marketplace: string,
  pathString: string,
  clientId: string,
  proxyOptions: Partial<ProxyOptions>
): Promise<void> {
  const requestId = uuidv4();

  try {
    // Создаём группу запросов
    const group = await paginationService.createGroup({
      clientId,
      marketplaceId: marketplace,
      originalUrl: request.url,
      originalMethod: request.method,
      paginationConfig: {
        type: 'auto', // Авто-определение типа пагинации
        limit: proxyOptions.limit || 100
      }
    });

    dbLogger.info(`Pagination started for group ${group.id}`, {
      metadata: {
        clientId,
        marketplace,
        paginationType: group.paginationType
      }
    });

    // Создаём первый запрос в группе
    const originalUrl = new URL(request.url, 'http://localhost');
    const targetPath = pathString.startsWith('/') ? pathString : '/' + pathString;
    const targetUrl = new URL(targetPath, `https://${marketplace}`);

    // Копируем query параметры (исключая служебные)
    for (const [key, value] of originalUrl.searchParams) {
      if (!key.startsWith('_')) { // Исключаем служебные параметры
        targetUrl.searchParams.set(key, value);
      }
    }

    // Добавляем параметры пагинации
    const config = group.paginationConfig;
    if (config?.type === 'offset') {
      targetUrl.searchParams.set(config.offsetParam || 'offset', '0');
      targetUrl.searchParams.set(config.limitParam || 'limit', String(config.limit || 100));
    } else if (config?.type === 'page') {
      targetUrl.searchParams.set(config.offsetParam || 'page', '1');
      targetUrl.searchParams.set(config.limitParam || 'limit', String(config.limit || 100));
    }

    const childRequestId = uuidv4();
    await queueService.enqueue({
      uuid: childRequestId,
      client_id: clientId,
      marketplace_id: marketplace,
      method: request.method,
      url: targetUrl.toString(),
      headers: filterHeaders(request.headers as Record<string, unknown>),
      body: request.body ? JSON.stringify(request.body) : undefined,
      priority: proxyOptions.priority || 'normal'
    });

    // Обновляем группу: добавляем информацию о запросе
    paginationService.createChildRequest({
      groupId: group.id,
      clientId,
      marketplaceId: marketplace,
      method: request.method,
      url: targetUrl.toString(),
      headers: filterHeaders(request.headers as Record<string, unknown>),
      body: request.body ? JSON.stringify(request.body) : undefined,
      pageNumber: 1,
      isLastPage: false
    });

    // Возвращаем ответ клиенту
    const response: PaginatedResponse = {
      success: true,
      request_group_id: group.id,
      status: 'processing',
      completed_pages: 1,
      pagination: {
        type: group.paginationType || 'auto',
        has_more: true
      }
    };

    reply.code(202).send(response);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Pagination failed', {
      requestId,
      clientId,
      action: 'pagination_failed',
      errorShort: errorMessage
    });

    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage,
      request_id: requestId
    });
  }
}
