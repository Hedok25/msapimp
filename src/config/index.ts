import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || './data/proxy.db',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-key',
    issuer: process.env.JWT_ISSUER || 'mp-proxy-service',
    audience: process.env.JWT_AUDIENCE || 'mp-proxy-service',
    expiresIn: '60m',
    refreshExpiresIn: '7d'
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@mp-proxy.local',
    password: process.env.ADMIN_PASSWORD || 'admin123'
  },
  logLevel: process.env.LOG_LEVEL || 'debug',
  rateLimit: {
    global: parseInt(process.env.RATE_LIMIT_GLOBAL || '1000', 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10)
  }
};

export default config;
