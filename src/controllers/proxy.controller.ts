import { FastifyRequest, FastifyReply } from 'fastify';
import https from 'https';
import http from 'http';
import zlib from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { dbLogger } from '../logging/index.js';
import { ProxyOptions } from '../types/index.js';

export interface ProxyRequestParams {
  marketplace: string;
  path: string[];
}

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

    // Определение таймаута
    const timeout = proxyOptions.timeout_override || marketplaceConfig.defaults.timeout;

    // Сохранение запроса в очередь
    const db = getDatabase();
    const insertStmt = db.prepare(`
      INSERT INTO requests (uuid, client_id, marketplace_id, method, url, headers, body, status, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?)
    `);

    // Фильтрация заголовков перед сохранением (убираем msapimp-key-api)
    const headersToSave = { ...request.headers };
    delete headersToSave['msapimp-key-api'];
    const headersJson = JSON.stringify(headersToSave);
    const bodyString = request.body ? JSON.stringify(request.body) : null;
    
    insertStmt.run(
      requestId,
      clientId,
      marketplace,
      request.method,
      finalTargetUrl.toString(),
      headersJson,
      bodyString,
      proxyOptions.priority || 'normal'
    );

    // Обновление статуса
    db.prepare('UPDATE requests SET status = ? WHERE uuid = ?').run('processing', requestId);

    // Выполнение запроса к МП
    const response = await makeRequestToMarketplace({
      url: finalTargetUrl,
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

    if (response.statusCode && response.statusCode >= 400) {
      const errorBody = response.body ? response.body.substring(0, 500) : 'No response body';

      dbLogger.error('Proxy request failed with error status', {
        requestId,
        clientId,
        action: 'proxy_failed',
        errorShort: `HTTP ${response.statusCode}`,
        errorMessage: `HTTP ${response.statusCode}: ${finalTargetUrl.toString()} - ${errorBody}`,
        metadata: {
          marketplace,
          statusCode: response.statusCode,
          method: request.method,
          targetUrl: finalTargetUrl.toString(),
          path: pathString,
          responseBody: errorBody
        }
      });
    } else {
      dbLogger.info('Proxy request completed', {
        requestId,
        clientId,
        action: 'proxy_completed',
        metadata: {
          marketplace,
          statusCode: response.statusCode
        }
      });
    }

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
      headers: {
        ...options.headers,
        'Accept-Encoding': 'gzip, deflate'
      },
      timeout: options.timeout
    };

    // Логирование заголовков запроса (без msapimp-key-api)
    const headersToLog = { ...options.headers };
    delete headersToLog['msapimp-key-api'];
    console.log('📤 Request Headers:', JSON.stringify(headersToLog, null, 2));

    const req = lib.request(reqOptions, (res) => {
      let body: Buffer = Buffer.alloc(0);

      res.on('data', (chunk) => {
        body = Buffer.concat([body, chunk]);
      });

      res.on('end', () => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (value) {
            headers[key] = Array.isArray(value) ? value.join(', ') : value;
          }
        }

        // Обработка gzip/deflate сжатия
        let bodyString = body.toString('utf8');
        try {
          if (headers['content-encoding']?.includes('gzip')) {
            bodyString = zlib.gunzipSync(body).toString('utf8');
          } else if (headers['content-encoding']?.includes('deflate')) {
            bodyString = zlib.inflateSync(body).toString('utf8');
          }
        } catch (e) {
          // Если раскомпрессия не удалась, используем как есть
          console.log('⚠️ Decompression failed, using raw body');
        }

        resolve({
          statusCode: res.statusCode || 0,
          headers,
          body: bodyString
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
