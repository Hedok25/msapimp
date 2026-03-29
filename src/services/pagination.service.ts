import { getDatabase } from '../db/index.js';
import { dbLogger } from '../logging/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Типы пагинации
 */
export type PaginationType = 'page' | 'offset' | 'cursor' | 'auto';

/**
 * Конфигурация пагинации
 */
export interface PaginationConfig {
  type: PaginationType;
  limit?: number;
  offsetParam?: string;      // Для offset: 'offset', 'page', 'skip'
  limitParam?: string;        // Для offset: 'limit', 'size', 'count'
  cursorParam?: string;       // Для cursor: 'cursor', 'next_cursor'
  totalPagesParam?: string;   // Параметр в ответе с общим числом страниц
  hasMoreParam?: string;      // Параметр в ответе с флагом has_more
}

/**
 * Статус группы запросов
 */
export type RequestGroupStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Группа запросов (для пагинации)
 */
export interface RequestGroup {
  id: string;
  clientId: string;
  marketplaceId: string;
  originalUrl: string;
  originalMethod: string;
  totalPages?: number;
  completedPages: number;
  status: RequestGroupStatus;
  paginationType?: PaginationType;
  paginationConfig?: PaginationConfig;
  errorMessage?: string;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * Сервис управления пагинацией запросов
 */
export class PaginationService {
  private static instance: PaginationService;

  // Конфигурации пагинации по маркетплейсам
  private paginationConfigs: Map<string, PaginationConfig> = new Map();

  private constructor() {
    this.initDefaultConfigs();
  }

  static getInstance(): PaginationService {
    if (!PaginationService.instance) {
      PaginationService.instance = new PaginationService();
    }
    return PaginationService.instance;
  }

  /**
   * Инициализация конфигураций по умолчанию
   */
  private initDefaultConfigs(): void {
    // Wildberries Statistics API
    this.paginationConfigs.set('statistics-api.wildberries.ru', {
      type: 'offset',
      limit: 1000,
      offsetParam: 'offset',
      limitParam: 'limit'
    });

    // Ozon API
    this.paginationConfigs.set('api-seller.ozon.ru', {
      type: 'page',
      limit: 100,
      offsetParam: 'page',
      limitParam: 'limit'
    });

    // Yandex Market API
    this.paginationConfigs.set('api.market.yandex.ru', {
      type: 'cursor',
      limit: 100,
      cursorParam: 'cursor',
      limitParam: 'limit'
    });
  }

  /**
   * Создание группы запросов для пагинации
   */
  async createGroup(params: {
    clientId: string;
    marketplaceId: string;
    originalUrl: string;
    originalMethod: string;
    paginationType?: PaginationType;
    paginationConfig?: Partial<PaginationConfig>;
  }): Promise<RequestGroup> {
    const db = getDatabase();
    const groupId = uuidv4();

    const config = this.paginationConfigs.get(params.marketplaceId) || {
      type: 'auto',
      limit: 100
    };

    const mergedConfig: PaginationConfig = {
      ...config,
      ...params.paginationConfig
    };

    const group: RequestGroup = {
      id: groupId,
      clientId: params.clientId,
      marketplaceId: params.marketplaceId,
      originalUrl: params.originalUrl,
      originalMethod: params.originalMethod,
      totalPages: undefined,
      completedPages: 0,
      status: 'pending',
      paginationType: mergedConfig.type,
      paginationConfig: mergedConfig,
      createdAt: new Date()
    };

    try {
      db.prepare(`
        INSERT INTO request_groups (
          id, client_id, marketplace_id, original_url, original_method,
          pagination_type, pagination_config, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
      `).run(
        groupId,
        params.clientId,
        params.marketplaceId,
        params.originalUrl,
        params.originalMethod,
        mergedConfig.type,
        JSON.stringify(mergedConfig)
      );

      dbLogger.info(`Request group created: ${groupId}`, {
        metadata: {
          clientId: params.clientId,
          marketplace: params.marketplaceId,
          paginationType: mergedConfig.type
        }
      });
    } catch (error) {
      dbLogger.error('Failed to create request group', {
        errorShort: error instanceof Error ? error.message : 'Unknown'
      });
      throw error;
    }

    return group;
  }

  /**
   * Получение группы по ID
   */
  getGroup(groupId: string): RequestGroup | null {
    const db = getDatabase();

    const row = db.prepare(`
      SELECT * FROM request_groups WHERE id = ?
    `).get(groupId) as any;

    if (!row) {
      return null;
    }

    return this.mapRowToGroup(row);
  }

  /**
   * Обновление статуса группы
   */
  updateGroupStatus(groupId: string, status: RequestGroupStatus, completedPages?: number): void {
    const db = getDatabase();

    const updates: string[] = ['status = ?'];
    const params: any[] = [status];

    if (completedPages !== undefined) {
      updates.push('completed_pages = ?');
      params.push(completedPages);
    }

    if (status === 'completed' || status === 'failed') {
      updates.push('completed_at = CURRENT_TIMESTAMP');
    }

    db.prepare(`
      UPDATE request_groups
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params, groupId);
  }

  /**
   * Обновление общего числа страниц
   */
  updateTotalPages(groupId: string, totalPages: number): void {
    const db = getDatabase();

    db.prepare(`
      UPDATE request_groups
      SET total_pages = ?
      WHERE id = ?
    `).run(totalPages, groupId);
  }

  /**
   * Создание дочернего запроса в группе
   */
  createChildRequest(params: {
    groupId: string;
    clientId: string;
    marketplaceId: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    pageNumber: number;
    nextPageUrl?: string;
    isLastPage: boolean;
    parentRequestId?: string;
  }): string {
    const db = getDatabase();
    const requestId = uuidv4();

    db.prepare(`
      INSERT INTO requests (
        uuid, group_id, client_id, marketplace_id, method, url, headers, body,
        status, page_number, next_page_url, is_last_page, parent_request_id,
        priority, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?, 'normal', CURRENT_TIMESTAMP)
    `).run(
      requestId,
      params.groupId,
      params.clientId,
      params.marketplaceId,
      params.method,
      params.url,
      JSON.stringify(params.headers),
      params.body,
      params.pageNumber,
      params.nextPageUrl || null,
      params.isLastPage ? 1 : 0,
      params.parentRequestId || null
    );

    // Обновляем completed_pages в группе
    db.prepare(`
      UPDATE request_groups
      SET completed_pages = completed_pages + 1
      WHERE id = ?
    `).run(params.groupId);

    return requestId;
  }

  /**
   * Получение всех запросов группы
   */
  getGroupRequests(groupId: string): any[] {
    const db = getDatabase();

    const rows = db.prepare(`
      SELECT * FROM requests
      WHERE group_id = ?
      ORDER BY page_number ASC
    `).all(groupId);

    return rows as any[];
  }

  /**
   * Агрегация ответов группы
   */
  aggregateGroupResponses(groupId: string): any[] {
    const requests = this.getGroupRequests(groupId);
    
    return requests.map((row: any) => {
      let responseBody = null;
      if (row.response_body) {
        try {
          responseBody = JSON.parse(row.response_body);
        } catch {
          responseBody = row.response_body;
        }
      }

      return {
        page: row.page_number,
        status: row.status,
        response_status: row.response_status,
        data: responseBody,
        completed_at: row.completed_at
      };
    });
  }

  /**
   * Проверка: все ли запросы в группе завершены
   */
  isGroupComplete(groupId: string): boolean {
    const db = getDatabase();

    const group = this.getGroup(groupId);
    if (!group) {
      return false;
    }

    // Если total_pages не задано, проверяем по is_last_page
    if (!group.totalPages) {
      const lastPage = db.prepare(`
        SELECT COUNT(*) as count FROM requests
        WHERE group_id = ? AND is_last_page = 1 AND status = 'completed'
      `).get(groupId) as any;

      return lastPage.count > 0;
    }

    // Проверяем, все ли страницы загружены
    const completedCount = db.prepare(`
      SELECT COUNT(*) as count FROM requests
      WHERE group_id = ? AND status = 'completed'
    `).get(groupId) as any;

    return completedCount.count >= group.totalPages;
  }

  /**
   * Завершение группы
   */
  completeGroup(groupId: string): void {
    const group = this.getGroup(groupId);
    if (!group) {
      return;
    }

    this.updateGroupStatus(groupId, 'completed', group.completedPages);

    dbLogger.info(`Request group completed: ${groupId}`, {
      metadata: {
        totalPages: group.totalPages,
        completedPages: group.completedPages
      }
    });
  }

  /**
   * Ошибка группы
   */
  failGroup(groupId: string, errorMessage: string): void {
    const db = getDatabase();

    db.prepare(`
      UPDATE request_groups
      SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(errorMessage, groupId);

    dbLogger.error(`Request group failed: ${groupId}`, {
      errorShort: errorMessage
    });
  }

  /**
   * Парсинг конфигурации пагинации из JSON
   */
  parsePaginationConfig(configJson: string): PaginationConfig | null {
    try {
      return JSON.parse(configJson);
    } catch {
      return null;
    }
  }

  /**
   * Преобразование строки БД в объект RequestGroup
   */
  private mapRowToGroup(row: any): RequestGroup {
    let paginationConfig: PaginationConfig | undefined;
    if (row.pagination_config) {
      paginationConfig = this.parsePaginationConfig(row.pagination_config) || undefined;
    }

    return {
      id: row.id,
      clientId: row.client_id,
      marketplaceId: row.marketplace_id,
      originalUrl: row.original_url,
      originalMethod: row.original_method,
      totalPages: row.total_pages,
      completedPages: row.completed_pages,
      status: row.status as RequestGroupStatus,
      paginationType: row.pagination_type as PaginationType,
      paginationConfig,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined
    };
  }
}

// Экспорт единственного экземпляра
export const paginationService = PaginationService.getInstance();
