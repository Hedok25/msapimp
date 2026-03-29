import { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { dbLogger } from '../logging/index.js';
import { ProxyOptions } from '../types/index.js';
import { queueService } from '../services/queue.service.js';

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
    // Парсинг X-Proxy-Options
    let proxyOptions: Partial<ProxyOptions> = {};
    const optionsHeader = request.headers['x-proxy-options'];

    if (optionsHeader) {
      try {
        const decoded = Buffer.from(optionsHeader as string, 'base64').toString('utf-8');
        if (decoded.length > 1024) {
          reply.code(413).send({ error: 'Payload Too Large', message: 'X-Proxy-Options exceeds 1KB limit' });
          return;
        }
        proxyOptions = JSON.parse(decoded);
      } catch (error) {
        reply.code(400).send({ error: 'Bad Request', message: 'Invalid X-Proxy-Options format' });
        return;
      }
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

async function getMarketplaceConfig(marketplaceId: string) {
  try {
    const configModule = await import('../config/marketplaces.json', { with: { type: 'json' } });
    const config = configModule.default as any;
    const mp = config.marketplaces.find((m: { id: string }) => m.id === marketplaceId);
    return mp || null;
  } catch (error) {
    console.error('Failed to load marketplace config:', error);
    return null;
  }
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
