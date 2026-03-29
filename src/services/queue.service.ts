import axios, { AxiosError } from 'axios';
import { getDatabase } from '../db/index.js';
import { dbLogger } from '../logging/index.js';
import { RequestStatus, ProxyOptions } from '../types/index.js';
import { circuitBreakerManager } from './circuit-breaker.service.js';

export interface QueuedRequest {
  uuid: string;
  client_id: string;
  marketplace_id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: RequestStatus;
  proxyOptions?: Partial<ProxyOptions>;
  createdAt: Date;
  // Кэшированные данные ответа
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: any;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  retrying: number;
  dead_letter: number;
}

export interface WorkerOptions {
  id: number;
  concurrency: number;
  pollIntervalMs: number;
}

/**
 * Сервис управления двухуровневой очередью запросов
 * Hot level: In-Memory (30 минут TTL)
 * Cold level: SQLite (24 часа TTL)
 */
export class QueueService {
  private static instance: QueueService;
  private workers: Map<number, boolean> = new Map();
  private isRunning: boolean = false;
  private readonly DEFAULT_WORKERS = 4;
  private readonly DEFAULT_POLL_INTERVAL = 100;

  // In-Memory очередь (Hot level)
  private memoryQueue: Map<string, QueuedRequest & { processed?: boolean }> = new Map();
  private memoryQueueTimestamps: Map<string, number> = new Map();
  private readonly MEMORY_TTL_MS = 30 * 60 * 1000; // 30 минут

  private constructor() {}

  static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  /**
   * Запуск worker pool и восстановление очереди
   */
  start(workersCount: number = this.DEFAULT_WORKERS): void {
    if (this.isRunning) {
      dbLogger.warn('Queue workers already running');
      return;
    }

    // Восстановление очереди после рестарта
    this.restoreQueueFromDatabase();

    this.isRunning = true;
    dbLogger.info(`Starting ${workersCount} queue workers`);

    for (let i = 0; i < workersCount; i++) {
      this.startWorker(i);
    }

    // Запуск фоновой задачи очистки In-Memory очереди
    this.startMemoryCleanup();
  }

  /**
   * Остановка всех workers
   */
  stop(): Promise<void> {
    this.isRunning = false;
    dbLogger.info('Stopping queue workers...');

    // Сохранение In-Memory очереди в SQLite перед остановкой
    this.saveMemoryQueueToDatabase();

    const promises: Promise<void>[] = [];
    this.workers.forEach((_, workerId) => {
      promises.push(this.stopWorker(workerId));
    });

    return Promise.all(promises).then(() => {
      dbLogger.info('All queue workers stopped');
    });
  }

  private startWorker(workerId: number): void {
    this.workers.set(workerId, true);
    setImmediate(() => this.processQueue(workerId));
  }

  private async stopWorker(workerId: number): Promise<void> {
    this.workers.set(workerId, false);
  }

  /**
   * Восстановление очереди после рестарта
   * Загружает активные запросы из SQLite в In-Memory
   */
  private restoreQueueFromDatabase(): void {
    const db = getDatabase();

    try {
      // Загружаем запросы со статусами accepted и processing за последние 24 часа
      const stmt = db.prepare(`
        SELECT uuid, client_id, marketplace_id, method, url, headers, body, priority, status, created_at
        FROM requests
        WHERE status IN ('accepted', 'processing')
          AND datetime(created_at) > datetime('now', '-24 hours')
        ORDER BY created_at ASC
      `);

      const rows = stmt.all() as any[];

      for (const row of rows) {
        const request: QueuedRequest = {
          uuid: row.uuid,
          client_id: row.client_id,
          marketplace_id: row.marketplace_id,
          method: row.method,
          url: row.url,
          headers: row.headers ? JSON.parse(row.headers) : {},
          body: row.body,
          priority: row.priority as 'low' | 'normal' | 'high' | 'critical',
          status: 'accepted', // Сбрасываем processing на accepted для повторной обработки
          createdAt: new Date(row.created_at)
        };

        // Восстанавливаем в In-Memory очередь
        this.memoryQueue.set(request.uuid, request);
        this.memoryQueueTimestamps.set(request.uuid, Date.now());

        // Обновляем статус в БД на accepted для повторной обработки
        db.prepare('UPDATE requests SET status = ? WHERE uuid = ?').run('accepted', request.uuid);
      }

      dbLogger.info(`Restored ${rows.length} requests from database to in-memory queue`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      dbLogger.error('Failed to restore queue from database', {
        errorShort: errorMessage
      });
    }
  }

  /**
   * Сохранение In-Memory очереди в SQLite (перед остановкой)
   */
  private saveMemoryQueueToDatabase(): void {
    const db = getDatabase();
    let savedCount = 0;

    for (const [uuid, request] of this.memoryQueue.entries()) {
      try {
        db.prepare(`
          UPDATE requests
          SET status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE uuid = ?
        `).run(request.status, uuid);
        savedCount++;
      } catch (error) {
        dbLogger.warn(`Failed to save request ${uuid} to database`, {
          errorShort: error instanceof Error ? error.message : 'Unknown'
        });
      }
    }

    dbLogger.info(`Saved ${savedCount} in-memory requests to database`);
  }

  /**
   * Фоновая задача очистки устаревших записей из In-Memory очереди
   */
  private startMemoryCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const expiredUuids: string[] = [];

      for (const [uuid, timestamp] of this.memoryQueueTimestamps.entries()) {
        if (now - timestamp > this.MEMORY_TTL_MS) {
          expiredUuids.push(uuid);
        }
      }

      for (const uuid of expiredUuids) {
        this.memoryQueue.delete(uuid);
        this.memoryQueueTimestamps.delete(uuid);
      }

      if (expiredUuids.length > 0) {
        dbLogger.info(`Cleaned up ${expiredUuids.length} expired requests from in-memory queue`);
      }
    }, 60 * 1000); // Каждую минуту
  }

  /**
   * Основной цикл обработки очереди воркером
   */
  private async processQueue(workerId: number): Promise<void> {
    while (this.isRunning && this.workers.get(workerId)) {
      try {
        // Сначала проверяем In-Memory очередь (Hot level)
        let request = this.getNextFromMemory();

        // Если In-Memory пуста, берем из БД (Cold level)
        if (!request) {
          request = await this.getNextFromDatabase();
        }

        if (!request) {
          // Нет запросов - ждем перед следующей проверкой
          await this.sleep(100);
          continue;
        }

        // Обновляем статус на processing
        await this.updateStatus(request.uuid, 'processing');

        // Обрабатываем запрос
        await this.processRequest(request, workerId);

      } catch (error) {
        dbLogger.error(`Worker ${workerId} error`, {
          errorShort: error instanceof Error ? error.message : 'Unknown error',
          metadata: { workerId }
        });
        await this.sleep(500);
      }
    }
  }

  /**
   * Получение следующего запроса из In-Memory очереди
   * Не удаляет запрос из памяти, а помечает как processed для кэширования
   */
  private getNextFromMemory(): QueuedRequest | null {
    const now = Date.now();
    let oldestRequest: QueuedRequest | null = null;
    let oldestUuid: string | null = null;
    let oldestTime = Infinity;

    // Находим самый старый запрос с учетом приоритета
    for (const [uuid, request] of this.memoryQueue.entries()) {
      const timestamp = this.memoryQueueTimestamps.get(uuid) || 0;

      // Пропускаем истекшие записи
      if (now - timestamp > this.MEMORY_TTL_MS) {
        continue;
      }

      // Пропускаем уже обрабатываемые и обработанные
      if (request.status === 'processing' || request.processed) {
        continue;
      }

      // Приоритет: critical > high > normal > low
      const priorityWeight = { critical: 0, high: 1, normal: 2, low: 3 };
      const weight = priorityWeight[request.priority] || 2;
      const score = weight * 1000000000 + timestamp;

      if (score < oldestTime) {
        oldestTime = score;
        oldestRequest = request;
        oldestUuid = uuid;
      }
    }

    // Помечаем запрос как обрабатываемый, но НЕ удаляем из памяти (для кэширования)
    if (oldestUuid && oldestRequest) {
      oldestRequest.status = 'processing';
      return oldestRequest;
    }

    return null;
  }

  /**
   * Получение следующего запроса из БД с учетом приоритета (Cold level)
   */
  private async getNextFromDatabase(): Promise<QueuedRequest | null> {
    const db = getDatabase();

    // Приоритет: critical > high > normal > low
    const priorityOrder = "CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5 END";

    const stmt = db.prepare(`
      SELECT uuid, client_id, marketplace_id, method, url, headers, body, priority, status, created_at
      FROM requests
      WHERE status = 'accepted'
      ORDER BY ${priorityOrder}, created_at ASC
      LIMIT 1
    `);

    const row = stmt.get() as any;
    if (!row) {
      return null;
    }

    return {
      uuid: row.uuid,
      client_id: row.client_id,
      marketplace_id: row.marketplace_id,
      method: row.method,
      url: row.url,
      headers: row.headers ? JSON.parse(row.headers) : {},
      body: row.body,
      priority: row.priority as 'low' | 'normal' | 'high' | 'critical',
      status: row.status as RequestStatus,
      createdAt: new Date(row.created_at)
    };
  }

  /**
   * Обработка запроса
   */
  private async processRequest(request: QueuedRequest, workerId: number): Promise<void> {
    const startTime = Date.now();

    try {
      dbLogger.info(`Worker ${workerId} processing request ${request.uuid}`, {
        metadata: {
          marketplace: request.marketplace_id,
          method: request.method,
          url: request.url
        }
      });

      // Выполняем запрос к маркетплейсу через axios
      const response = await axios({
        method: request.method,
        url: request.url,
        headers: request.headers,
        data: request.body,
        timeout: 30000, // 30 секунд по умолчанию
        validateStatus: () => true, // Не выбрасывать ошибку на 4xx/5xx
        decompress: true, // axios автоматически обработает gzip/deflate
        responseType: 'text'
      });

      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(response.headers)) {
        if (value) {
          responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
        }
      }

      const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

      // Обновляем статус на completed в БД
      await this.updateStatus(request.uuid, 'completed', {
        response_status: response.status,
        response_headers: JSON.stringify(responseHeaders),
        response_body: responseBody
      });

      // Обновляем статус и кэшируем ответ в In-Memory памяти
      const memoryRequest = this.memoryQueue.get(request.uuid);
      if (memoryRequest) {
        memoryRequest.status = 'completed';
        memoryRequest.processed = true;
        memoryRequest.responseStatus = response.status;
        memoryRequest.responseHeaders = responseHeaders;
        // Парсим JSON только один раз при сохранении
        try {
          memoryRequest.responseBody = JSON.parse(responseBody);
        } catch {
          memoryRequest.responseBody = responseBody;
        }
      }

      const duration = Date.now() - startTime;

      if (response.status >= 400) {
        dbLogger.warn(`Worker ${workerId} completed request ${request.uuid} with status ${response.status} in ${duration}ms`);
        
        // Записываем ошибку в Circuit Breaker
        circuitBreakerManager.recordFailure(request.marketplace_id, response.status);
      } else {
        dbLogger.info(`Worker ${workerId} completed request ${request.uuid} in ${duration}ms`);
        
        // Записываем успех в Circuit Breaker
        circuitBreakerManager.recordSuccess(request.marketplace_id);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      dbLogger.error(`Worker ${workerId} failed to process request ${request.uuid}`, {
        errorShort: errorMessage,
        metadata: { uuid: request.uuid }
      });

      // Записываем ошибку в Circuit Breaker
      circuitBreakerManager.recordFailure(request.marketplace_id);

      // Обновляем статус на failed
      await this.updateStatus(request.uuid, 'failed', {
        error_message: errorMessage
      });
    }
  }

  /**
   * Обновление статуса запроса
   */
  async updateStatus(
    uuid: string,
    status: RequestStatus,
    additionalData?: {
      response_status?: number;
      response_headers?: string;
      response_body?: string;
      error_message?: string;
    }
  ): Promise<void> {
    const db = getDatabase();
    
    const updates: string[] = ['status = ?'];
    const params: any[] = [status];

    if (additionalData) {
      if (additionalData.response_status !== undefined) {
        updates.push('response_status = ?');
        params.push(additionalData.response_status);
      }
      if (additionalData.response_headers !== undefined) {
        updates.push('response_headers = ?');
        params.push(additionalData.response_headers);
      }
      if (additionalData.response_body !== undefined) {
        updates.push('response_body = ?');
        params.push(additionalData.response_body);
      }
      if (additionalData.error_message !== undefined) {
        updates.push('error_message = ?');
        params.push(additionalData.error_message);
      }
    }

    if (['completed', 'failed', 'dead_letter'].includes(status)) {
      updates.push('completed_at = CURRENT_TIMESTAMP');
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const stmt = db.prepare(`
      UPDATE requests
      SET ${updates.join(', ')}
      WHERE uuid = ?
    `);

    stmt.run(...params, uuid);
  }

  /**
   * Добавление запроса в очередь (двухуровневая: In-Memory + SQLite)
   */
  async enqueue(request: {
    uuid: string;
    client_id: string;
    marketplace_id: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    priority?: 'low' | 'normal' | 'high' | 'critical';
  }): Promise<void> {
    const db = getDatabase();
    const now = Date.now();

    // Создаем объект запроса для In-Memory очереди
    const queuedRequest: QueuedRequest = {
      uuid: request.uuid,
      client_id: request.client_id,
      marketplace_id: request.marketplace_id,
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
      priority: request.priority || 'normal',
      status: 'accepted',
      createdAt: new Date()
    };

    // Сохраняем в БД (Cold level)
    const stmt = db.prepare(`
      INSERT INTO requests (uuid, client_id, marketplace_id, method, url, headers, body, status, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?)
    `);

    stmt.run(
      request.uuid,
      request.client_id,
      request.marketplace_id,
      request.method,
      request.url,
      JSON.stringify(request.headers),
      request.body || null,
      request.priority || 'normal'
    );

    // Добавляем в In-Memory очередь (Hot level) для быстрой обработки
    this.memoryQueue.set(request.uuid, queuedRequest);
    this.memoryQueueTimestamps.set(request.uuid, now);

    dbLogger.info(`Request ${request.uuid} enqueued (in-memory + sqlite)`, {
      metadata: {
        marketplace: request.marketplace_id,
        priority: request.priority || 'normal'
      }
    });
  }

  /**
   * Получение статистики очереди
   */
  async getStats(): Promise<QueueStats> {
    const db = getDatabase();

    const stmt = db.prepare(`
      SELECT 
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'retrying' THEN 1 ELSE 0 END) as retrying,
        SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) as dead_letter
      FROM requests
      WHERE status NOT IN ('completed', 'failed', 'dead_letter') 
         OR created_at > datetime('now', '-1 hour')
    `);

    const row = stmt.get() as any;

    return {
      pending: row?.pending || 0,
      processing: row?.processing || 0,
      completed: row?.completed || 0,
      failed: row?.failed || 0,
      retrying: row?.retrying || 0,
      dead_letter: row?.dead_letter || 0
    };
  }

  /**
   * Получение запроса из In-Memory очереди (только Hot level)
   */
  getRequestFromMemory(uuid: string): QueuedRequest | null {
    const request = this.memoryQueue.get(uuid);
    console.log('🔍 getRequestFromMemory:', uuid, '→', request ? 'FOUND' : 'NOT FOUND');
    return request || null;
  }

  /**
   * Получение размера In-Memory очереди
   */
  getMemoryQueueSize(): number {
    return this.memoryQueue.size;
  }

  /**
   * Восстановление запроса в In-Memory память (при чтении из SQLite)
   */
  async restoreToMemory(request: Omit<QueuedRequest, 'proxyOptions'> & { responseStatus?: number; responseBody?: any }): Promise<void> {
    const now = Date.now();

    this.memoryQueue.set(request.uuid, {
      ...request,
      processed: true, // Помечаем как обработанный (не удалять воркером)
      responseStatus: request.responseStatus,
      responseBody: request.responseBody
    } as QueuedRequest & { processed: boolean });
    this.memoryQueueTimestamps.set(request.uuid, now);

    console.log('📥 Request added to In-Memory:', request.uuid);
    dbLogger.debug(`Request ${request.uuid} restored to In-Memory queue`);
  }

  /**
   * Получение запроса по UUID (двухуровневая очередь: In-Memory → SQLite)
   */
  async getRequest(uuid: string): Promise<QueuedRequest | null> {
    // Уровень 1: Проверка In-Memory очереди (Hot level)
    const memoryRequest = this.memoryQueue.get(uuid);
    if (memoryRequest) {
      dbLogger.debug(`Request ${uuid} found in In-Memory queue`);
      return memoryRequest;
    }

    // Уровень 2: Проверка SQLite (Cold level)
    dbLogger.debug(`Request ${uuid} not found in In-Memory, checking SQLite`);
    const db = getDatabase();

    const stmt = db.prepare(`
      SELECT uuid, client_id, marketplace_id, method, url, headers, body,
             status, response_status, response_headers, response_body,
             error_message, attempts, priority, created_at, updated_at, completed_at
      FROM requests
      WHERE uuid = ?
    `);

    const row = stmt.get(uuid) as any;
    if (!row) {
      return null;
    }

    return {
      uuid: row.uuid,
      client_id: row.client_id,
      marketplace_id: row.marketplace_id,
      method: row.method,
      url: row.url,
      headers: row.headers ? JSON.parse(row.headers) : {},
      body: row.body,
      priority: row.priority as 'low' | 'normal' | 'high' | 'critical',
      status: row.status as RequestStatus,
      createdAt: new Date(row.created_at)
    };
  }

  /**
   * Удаление запроса из очереди
   */
  async delete(uuid: string): Promise<boolean> {
    const db = getDatabase();

    const stmt = db.prepare('DELETE FROM requests WHERE uuid = ?');
    const result = stmt.run(uuid);

    return result.changes > 0;
  }

  /**
   * Очистка завершенных запросов
   */
  async clearCompleted(olderThan: Date): Promise<number> {
    const db = getDatabase();

    const stmt = db.prepare(`
      DELETE FROM requests
      WHERE status IN ('completed', 'failed')
        AND completed_at < ?
    `);

    const result = stmt.run(olderThan.toISOString());
    return result.changes;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Экспорт единственного экземпляра
export const queueService = QueueService.getInstance();
