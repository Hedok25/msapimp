// AdminJS требует сложной настройки адаптеров, используем простой REST API для админки
import { getDatabase } from '../db/index.js';

export interface AdminResource {
  tableName: string;
  navigation: { name: string; icon: string };
}

export const resources: AdminResource[] = [
  { tableName: 'clients', navigation: { name: 'Клиенты', icon: 'Users' } },
  { tableName: 'requests', navigation: { name: 'Запросы', icon: 'List' } },
  { tableName: 'logs', navigation: { name: 'Логи', icon: 'FileText' } },
  { tableName: 'auth_logs', navigation: { name: 'Auth', icon: 'Lock' } },
  { tableName: 'access_tokens', navigation: { name: 'Tokens', icon: 'Key' } },
  { tableName: 'jwt_blacklist', navigation: { name: 'JWT Blacklist', icon: 'Ban' } },
  { tableName: 'audit_logs', navigation: { name: 'Аудит', icon: 'Shield' } }
];

export async function createAdminRouter() {
  const { default: AdminJS } = await import('adminjs');
  
  const db = getDatabase();

  const adminJs = new AdminJS({
    rootPath: '/admin',
    branding: {
      companyName: 'MP Proxy Service',
      theme: {
        colors: {
          primary100: '#4268F6'
        }
      }
    },
    locale: {
      language: 'ru'
    },
    dashboard: {
      component: 'Dashboard',
      handler: async () => {
        // Статистика для дашборда
        const tables = ['clients', 'requests', 'logs', 'auth_logs'];
        const stats: Record<string, number> = {};
        
        for (const table of tables) {
          const result = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
          stats[table] = result.count;
        }
        
        return { stats };
      }
    }
  });

  return adminJs;
}

export default createAdminRouter;
