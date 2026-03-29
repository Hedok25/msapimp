import { FastifyRequest, FastifyReply } from 'fastify';
import { queueService } from '../services/queue.service.js';

/**
 * GET /api/v1/queue/stats
 * Статистика очереди запросов
 */
export async function getQueueStatsController(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const stats = await queueService.getStats();

    reply.send({
      success: true,
      data: {
        queue: stats,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * GET /api/v1/queue/:uuid
 * Получение запроса по UUID (двухуровневая очередь: In-Memory → SQLite)
 * Если запрос найден в SQLite, он восстанавливается в In-Memory для быстрого доступа
 */
export async function getRequestController(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { uuid } = request.params as { uuid: string };
    const startTime = Date.now();

    console.log('\n📋 ==========================================');
    console.log(`📋 Запрос: GET /api/v1/queue/${uuid}`);
    console.log(`📋 Время начала: ${new Date(startTime).toISOString()}`);
    console.log(`📋 In-Memory queue size: ${queueService.getMemoryQueueSize()} элементов`);
    console.log('📋 ------------------------------------------');

    // Уровень 1: Проверка In-Memory очереди (Hot level)
    const cachedRequest = queueService.getRequestFromMemory(uuid);

    if (cachedRequest) {
      const duration = Date.now() - startTime;
      console.log('✅ [1/2] Взято из In-Memory памяти');
      console.log(`📋 In-Memory queue size: ${queueService.getMemoryQueueSize()} элементов`);

      // Проверяем, есть ли кэшированный ответ
      if (cachedRequest.responseBody !== undefined) {
        console.log(`⏱️ Время выполнения: ${duration}мс`);
        console.log('📦 Возвращаем кэшированный ответ из памяти');
        reply.send({
          success: true,
          data: {
            status: cachedRequest.responseStatus || cachedRequest.status,
            response_body: cachedRequest.responseBody,
            from: 'memory',
            responseTime: `${duration}мс`
          }
        });
      } else {
        // Если ответа нет в кэше, получаем из SQLite
        console.log('📦 Ответа нет в кэше, получаем из SQLite');
        const { getDatabase } = await import('../db/index.js');
        const database = getDatabase();
        const row = database.prepare('SELECT response_body, status FROM requests WHERE uuid = ?').get(uuid) as any;

        const totalDuration = Date.now() - startTime;
        console.log(`⏱️ Время выполнения: ${totalDuration}мс`);
        reply.send({
          success: true,
          data: {
            status: row?.status || cachedRequest.status,
            response_body: row?.response_body ? JSON.parse(row.response_body) : null,
            from: 'memory',
            responseTime: `${totalDuration}мс`
          }
        });
      }
      console.log('📋 ==========================================\n');
      return;
    }

    console.log('⚠️ [1/2] Не найдено в In-Memory, проверка SQLite...');

    // Уровень 2: Проверка SQLite (Cold level)
    const { getDatabase } = await import('../db/index.js');
    const database = getDatabase();

    const row = database.prepare('SELECT * FROM requests WHERE uuid = ?').get(uuid) as any;

    if (!row) {
      const duration = Date.now() - startTime;
      console.log('❌ [2/2] Не найдено в SQLite');
      console.log(`⏱️ Время выполнения: ${duration}мс`);
      console.log(`📋 In-Memory queue size: ${queueService.getMemoryQueueSize()} элементов`);
      console.log('📋 ==========================================\n');
      reply.code(404).send({
        error: 'Not Found',
        message: `Request with UUID ${uuid} not found`
      });
      return;
    }

    console.log('✅ [2/2] Найдено в SQLite');
    console.log('📥 Добавляем в In-Memory память...');

    // Восстанавливаем запрос в In-Memory память с кэшированием ответа
    const result: any = JSON.parse(JSON.stringify(row));
    const responseBody = result.response_body ? JSON.parse(result.response_body) : null;

    await queueService.restoreToMemory({
      uuid: result.uuid,
      client_id: result.client_id,
      marketplace_id: result.marketplace_id,
      method: result.method,
      url: result.url,
      headers: result.headers ? JSON.parse(result.headers) : {},
      body: result.body,
      priority: result.priority as 'low' | 'normal' | 'high' | 'critical',
      status: result.status,
      createdAt: new Date(result.created_at),
      responseStatus: result.response_status,
      responseBody: responseBody
    });

    // Проверяем, что запрос действительно добавлен в память
    const verifyRequest = queueService.getRequestFromMemory(uuid);
    const totalDuration = Date.now() - startTime;
    console.log(`🔍 Проверка после добавления: ${verifyRequest ? 'УСПЕХ' : 'ОШИБКА'}`);
    console.log(`⏱️ Время выполнения: ${totalDuration}мс`);
    console.log(`📋 In-Memory queue size: ${queueService.getMemoryQueueSize()} элементов`);
    console.log('📋 ==========================================\n');

    reply.send({
      success: true,
      data: {
        status: result.status,
        response_body: result.response_body ? JSON.parse(result.response_body) : null,
        from: 'sqlite',
        responseTime: `${totalDuration}мс`
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Ошибка в getRequestController:', errorMessage);
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * DELETE /api/v1/queue/:uuid
 * Удаление запроса из очереди
 */
export async function deleteRequestController(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { uuid } = request.params as { uuid: string };

    const deleted = await queueService.delete(uuid);

    if (!deleted) {
      reply.code(404).send({
        error: 'Not Found',
        message: `Request with UUID ${uuid} not found`
      });
      return;
    }

    reply.send({
      success: true,
      message: `Request ${uuid} deleted successfully`
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * POST /api/v1/queue/clear
 * Очистка завершенных запросов (admin only)
 */
export async function clearQueueController(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const body = request.body as { olderThan?: string };

    // По умолчанию очищаем запросы старше 1 часа
    const olderThan = body?.olderThan
      ? new Date(body.olderThan)
      : new Date(Date.now() - 60 * 60 * 1000);

    const deletedCount = await queueService.clearCompleted(olderThan);

    reply.send({
      success: true,
      message: `Cleared ${deletedCount} completed requests`,
      deletedCount
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}
