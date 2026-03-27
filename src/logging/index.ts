import pino, { Logger } from 'pino';
import config from '../config/index.js';
import { getDatabase } from '../db/index.js';

const logger: Logger = pino({
  level: config.logLevel,
  transport: config.nodeEnv === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  } : undefined,
  formatters: {
    level: (label) => ({ level: label })
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

interface LogContext {
  requestId?: string;
  clientId?: string;
  action?: string;
  errorShort?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

// Функция для записи лога в БД
export function logToDatabase(
  level: string,
  message: string,
  context?: LogContext
): void {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO logs (level, request_id, client_id, action, message, error_short, error_message, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      level,
      context?.requestId || null,
      context?.clientId || null,
      context?.action || null,
      message,
      context?.errorShort || null,
      context?.errorMessage || null,
      context?.metadata ? JSON.stringify(context.metadata) : null
    );
  } catch (error) {
    console.error('Failed to write log to database:', error);
  }
}

// Обёртки для логирования с записью в БД
export const dbLogger = {
  info: (message: string, context?: LogContext) => {
    logger.info(context?.requestId ? { requestId: context.requestId } : {}, message);
    logToDatabase('info', message, context);
  },
  warn: (message: string, context?: LogContext) => {
    logger.warn(context?.requestId ? { requestId: context.requestId } : {}, message);
    logToDatabase('warn', message, context);
  },
  error: (message: string, context?: LogContext) => {
    logger.error(context?.requestId ? { requestId: context.requestId } : {}, message);
    logToDatabase('error', message, context);
  },
  debug: (message: string, context?: LogContext) => {
    logger.debug(context?.requestId ? { requestId: context.requestId } : {}, message);
    logToDatabase('debug', message, context);
  }
};

export { logger };
export default logger;
