import { FastifyRequest, FastifyReply } from 'fastify';
import { paginationService } from '../services/pagination.service.js';
import { dbLogger } from '../logging/index.js';

/**
 * GET /api/v1/pagination/groups/:groupId
 * Получение статуса группы запросов
 */
export async function getGroupStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const params = request.params as { groupId: string };
    const { groupId } = params;

    const group = paginationService.getGroup(groupId);

    if (!group) {
      reply.code(404).send({
        error: 'Not Found',
        message: `Request group ${groupId} not found`
      });
      return;
    }

    const isComplete = paginationService.isGroupComplete(groupId);

    reply.send({
      success: true,
      data: {
        request_group_id: group.id,
        client_id: group.clientId,
        marketplace_id: group.marketplaceId,
        original_url: group.originalUrl,
        status: isComplete ? 'completed' : group.status,
        pagination: {
          type: group.paginationType,
          total_pages: group.totalPages,
          completed_pages: group.completedPages,
          has_more: !isComplete
        },
        created_at: group.createdAt,
        completed_at: group.completedAt
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to get group status', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * GET /api/v1/pagination/groups/:groupId/results
 * Получение агрегированных результатов группы
 */
export async function getGroupResults(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const params = request.params as { groupId: string };
    const { groupId } = params;

    const group = paginationService.getGroup(groupId);

    if (!group) {
      reply.code(404).send({
        error: 'Not Found',
        message: `Request group ${groupId} not found`
      });
      return;
    }

    const isComplete = paginationService.isGroupComplete(groupId);

    if (!isComplete) {
      reply.code(202).send({
        success: true,
        request_group_id: groupId,
        status: 'processing',
        completed_pages: group.completedPages,
        total_pages: group.totalPages,
        message: 'Pagination in progress. Please try again later.',
        retry_after: 5
      });
      return;
    }

    // Агрегируем ответы
    const aggregatedData = paginationService.aggregateGroupResponses(groupId);

    reply.send({
      success: true,
      request_group_id: groupId,
      status: 'completed',
      total_pages: aggregatedData.length,
      pagination: {
        type: group.paginationType,
        has_more: false
      },
      data: aggregatedData
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to get group results', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}

/**
 * GET /api/v1/pagination/groups/:groupId/requests
 * Получение списка всех запросов в группе
 */
export async function getGroupRequests(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const params = request.params as { groupId: string };
    const { groupId } = params;

    const group = paginationService.getGroup(groupId);

    if (!group) {
      reply.code(404).send({
        error: 'Not Found',
        message: `Request group ${groupId} not found`
      });
      return;
    }

    const requests = paginationService.getGroupRequests(groupId);

    reply.send({
      success: true,
      request_group_id: groupId,
      total_requests: requests.length,
      data: requests.map((row: any) => ({
        request_id: row.uuid,
        page_number: row.page_number,
        status: row.status,
        url: row.url,
        response_status: row.response_status,
        created_at: row.created_at,
        completed_at: row.completed_at
      }))
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    dbLogger.error('Failed to get group requests', { errorShort: errorMessage });
    reply.code(500).send({
      error: 'Internal Server Error',
      message: errorMessage
    });
  }
}
