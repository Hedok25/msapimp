import { FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/index.js';

interface HealthQuery {
  ready?: string;
}

interface LogsQuery {
  level?: string;
  limit?: number;
  clientId?: string;
}

interface ClearLogsQuery {
  before?: string;
}

export async function healthController(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const query = request.query as HealthQuery;
  const ready = query.ready === 'true';
  
  const db = getDatabase();
  let dbStatus = 'connected';
  
  try {
    db.prepare('SELECT 1').get();
  } catch (error) {
    dbStatus = 'disconnected';
  }

  const response: Record<string, unknown> = {
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    uptime_sec: Math.floor(process.uptime()),
    database: {
      sqlite: dbStatus
    },
    timestamp: new Date().toISOString()
  };

  if (ready) {
    response['ready'] = dbStatus === 'connected';
  }

  if (dbStatus !== 'connected') {
    reply.code(503);
  }

  reply.send(response);
}

export async function getQueueStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const db = getDatabase();
  
  const stats = db.prepare(`
    SELECT 
      status,
      COUNT(*) as count
    FROM requests
    WHERE completed_at IS NULL OR datetime(completed_at) > datetime('now', '-30 minutes')
    GROUP BY status
  `).all() as { status: string; count: number }[];

  const result: Record<string, number> = {};
  for (const stat of stats) {
    result[stat.status] = stat.count;
  }

  reply.send({
    queue: result,
    timestamp: new Date().toISOString()
  });
}

export async function getLogs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const db = getDatabase();
  const query = request.query as LogsQuery;
  const { level, limit = 100, clientId } = query;

  let params: any[] = [];
  let whereClause = 'WHERE 1=1';

  if (level) {
    whereClause += ' AND level = ?';
    params.push(level);
  }

  if (clientId) {
    whereClause += ' AND client_id = ?';
    params.push(clientId);
  }

  params.push(limit);

  const logs = db.prepare(`SELECT * FROM logs ${whereClause} ORDER BY timestamp DESC LIMIT ?`).all(...params);

  reply.send({ logs, count: logs.length });
}

export async function clearLogs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const db = getDatabase();
  const query = request.query as ClearLogsQuery;
  const { before } = query;

  if (!before) {
    reply.code(400).send({ error: 'Bad Request', message: 'Parameter "before" is required' });
    return;
  }

  const result = db.prepare('DELETE FROM logs WHERE timestamp < ?').run(before);

  reply.send({ deleted: result.changes });
}
