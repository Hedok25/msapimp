import { FastifyRequest, FastifyReply } from 'fastify';
import https from 'https';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { dbLogger } from '../logging/index.js';
import { ProxyOptions } from '../types/index.js';

export interface ProxyRequestParams {
  marketplace: string;
  path: string[];
}

export async function proxyController(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = request.params as unknown as ProxyRequestParams;
  const marketplace = params.marketplace;
  const pathSegments = params.path || [];
  
  const req = request as any;
  const requestId = uuidv4();
  const clientId = req.user?.sub || 'anonymous';

  dbLogger.info('Proxy request received', {
    requestId,
    clientId,
    action: 'proxy_request',
    metadata: {
      marketplace,
      path: pathSegments.join('/'),
      method: request.method,
      url: request.url
    }
  });

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
    if (!marketplaceConfig) {
      reply.code(404).send({ error: 'Not Found', message: `Marketplace "${marketplace}" not found` });
      return;
    }

    // Формирование URL запроса к МП
    const targetPath = '/' + pathSegments.join('/');
    const targetUrl = new URL(targetPath, marketplaceConfig.baseUrl);

    // Определение таймаута
    const timeout = proxyOptions.timeout_override || marketplaceConfig.defaults.timeout;

    // Сохранение запроса в очередь
    const db = getDatabase();
    const insertStmt = db.prepare(`
      INSERT INTO requests (uuid, client_id, marketplace_id, method, url, headers, body, status, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?)
    `);
    
    const headersJson = JSON.stringify(request.headers);
    const bodyString = request.body ? JSON.stringify(request.body) : null;
    
    insertStmt.run(
      requestId,
      clientId,
      marketplace,
      request.method,
      targetUrl.toString(),
      headersJson,
      bodyString,
      proxyOptions.priority || 'normal'
    );

    // Обновление статуса
    db.prepare('UPDATE requests SET status = ? WHERE uuid = ?').run('processing', requestId);

    // Выполнение запроса к МП
    const response = await makeRequestToMarketplace({
      url: targetUrl,
      method: request.method as string,
      headers: filterHeaders(request.headers),
      body: request.body ? JSON.stringify(request.body) : undefined,
      timeout
    });

    // Сохранение ответа
    const updateStmt = db.prepare(`
      UPDATE requests 
      SET status = ?, response_status = ?, response_headers = ?, response_body = ?, completed_at = CURRENT_TIMESTAMP
      WHERE uuid = ?
    `);
    
    updateStmt.run(
      'completed',
      response.statusCode,
      JSON.stringify(response.headers),
      response.body,
      requestId
    );

    dbLogger.info('Proxy request completed', {
      requestId,
      clientId,
      action: 'proxy_completed',
      metadata: {
        marketplace,
        statusCode: response.statusCode
      }
    });

    // Формирование ответа клиенту
    const responseFormat = proxyOptions.response_format || 'wrapped';
    
    if (responseFormat === 'raw') {
      reply.headers(response.headers);
      reply.code(response.statusCode);
      reply.send(response.body);
    } else {
      reply.send({
        success: true,
        data: response.body ? JSON.parse(response.body) : null,
        metadata: {
          request_id: requestId,
          marketplace,
          status_code: response.statusCode,
          timestamp: new Date().toISOString()
        }
      });
    }

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

    // Обновление статуса в БД
    const db = getDatabase();
    db.prepare(`
      UPDATE requests 
      SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP
      WHERE uuid = ?
    `).run('failed', errorMessage, requestId);

    reply.code(502).send({
      error: 'Bad Gateway',
      message: errorMessage,
      request_id: requestId
    });
  }
}

async function getMarketplaceConfig(marketplaceId: string) {
  try {
    const configModule = await import('../config/marketplaces.json', { assert: { type: 'json' } });
    const config = configModule.default as any;
    const mp = config.marketplaces.find((m: { id: string }) => m.id === marketplaceId);
    return mp || null;
  } catch (error) {
    return null;
  }
}

function filterHeaders(headers: Record<string, unknown>): Record<string, string> {
  const forbiddenHeaders = ['host', 'content-length', 'connection', 'authorization'];
  const filtered: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(headers)) {
    if (!forbiddenHeaders.includes(key.toLowerCase()) && typeof value === 'string') {
      filtered[key] = value;
    }
  }
  
  return filtered;
}

interface RequestOptions {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeout: number;
}

interface Response {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function makeRequestToMarketplace(options: RequestOptions): Promise<Response> {
  return new Promise((resolve, reject) => {
    const isHttps = options.url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqOptions = {
      hostname: options.url.hostname,
      port: options.url.port || (isHttps ? 443 : 80),
      path: options.url.pathname + options.url.search,
      method: options.method,
      headers: options.headers,
      timeout: options.timeout
    };

    const req = lib.request(reqOptions, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (value) {
            headers[key] = Array.isArray(value) ? value.join(', ') : value;
          }
        }

        resolve({
          statusCode: res.statusCode || 0,
          headers,
          body
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}
