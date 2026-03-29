import Fastify, { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyFormbody from '@fastify/formbody';
import { initDatabase, closeDatabase } from './db/index.js';
import config from './config/index.js';
import { authRoutes } from './routes/auth.routes.js';
import { healthRoutes, proxyRoutes } from './routes/index.js';
import { resources } from './admin/index.js';
import logger from './logging/index.js';
import { adminMiddleware } from './middleware/auth.middleware.js';
import { queueService } from './services/queue.service.js';

async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: config.logLevel
    }
  });

  // Регистрация плагинов
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false
  });

  // Явная регистрация JSON парсера
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
    try {
      const json = JSON.parse(body as string);
      done(null, json);
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  await fastify.register(fastifyFormbody);

  await fastify.register(fastifyRateLimit, {
    max: config.rateLimit.global,
    timeWindow: config.rateLimit.windowMs,
    allowList: ['127.0.0.1', '::1']
  });

  // Swagger документация
  await fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'MP Proxy Service API',
        description: 'Прокси-сервис для маршрутизации запросов к API маркетплейсов',
        version: '1.0.0'
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Development server'
        }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'msapimp-key-api',
            description: 'JWT токен в заголовке msapimp-key-api (без префикса Bearer)'
          }
        }
      }
    }
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false
    }
  });

  // Регистрация маршрутов
  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(healthRoutes, { prefix: '/api/v1' });
  await fastify.register(proxyRoutes, { prefix: '/api/v1/proxy' });

  // AdminJS REST API для работы с данными + UI
  await fastify.register(async (fastify) => {
    const db = await import('./db/index.js').then(m => m.getDatabase());

    // Страница входа для админки
    fastify.get('/login', async (request, reply) => {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login - MP Proxy</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .login-container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); width: 100%; max-width: 400px; }
    h1 { color: #333; text-align: center; margin-bottom: 10px; font-size: 24px; }
    .subtitle { color: #666; text-align: center; margin-bottom: 30px; font-size: 14px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 8px; color: #333; font-weight: 500; }
    input[type="email"], input[type="password"] { width: 100%; padding: 12px 16px; border: 2px solid #e1e1e1; border-radius: 8px; font-size: 14px; transition: border-color 0.3s; }
    input:focus { outline: none; border-color: #667eea; }
    .btn-login { width: 100%; padding: 14px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: transform 0.2s; }
    .btn-login:hover { transform: translateY(-2px); }
    .error { background: #fee; color: #c00; padding: 12px; border-radius: 8px; margin-bottom: 20px; text-align: center; display: none; }
    .loading { text-align: center; color: #667eea; display: none; }
  </style>
</head>
<body>
  <div class="login-container">
    <h1>🔐 MP Proxy Admin</h1>
    <p class="subtitle">Sign in to access the admin panel</p>
    <div class="error" id="error"></div>
    <form id="loginForm">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required autocomplete="email">
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      <button type="submit" class="btn-login">Sign In</button>
    </form>
    <div class="loading" id="loading">Signing in...</div>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('error');
      const loadingEl = document.getElementById('loading');
      errorEl.style.display = 'none';
      loadingEl.style.display = 'block';

      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      try {
        console.log('Logging in with:', email);
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        console.log('Response status:', res.status);
        const data = await res.json();
        console.log('Response data:', data);

        if (!res.ok) {
          throw new Error(data.message || 'Login failed');
        }

        // Save tokens
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('refresh_token', data.refresh_token);

        // Check role
        const meRes = await fetch('/auth/me', {
          headers: { 'msapimp-key-api': 'Bearer ' + data.access_token }
        });
        const meData = await meRes.json();
        console.log('User data:', meData);

        if (meData.role !== 'admin') {
          localStorage.clear();
          throw new Error('Access denied: admin role required');
        }

        window.location.href = '/admin';
      } catch (err) {
        console.error('Login error:', err);
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      } finally {
        loadingEl.style.display = 'none';
      }
    });

    // Проверяем, есть ли уже активная сессия - если да, показываем кнопку перехода
    (async () => {
      const token = localStorage.getItem('access_token');
      if (token) {
        try {
          const res = await fetch('/auth/me', {
            headers: { 'msapimp-key-api': 'Bearer ' + token }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.role === 'admin') {
              // Показываем кнопку вместо формы входа
              document.querySelector('.login-container').innerHTML = \`
                <h1>🔐 MP Proxy Admin</h1>
                <p class="subtitle">Already signed in</p>
                <button class="btn-login" onclick="window.location.href='/admin'">Go to Admin Panel</button>
              \`;
              return;
            }
          }
          // Если токен не валиден - очищаем
          localStorage.clear();
        } catch (e) {
          localStorage.clear();
        }
      }
    })();
  </script>
</body>
</html>
      `;
      reply.type('text/html').send(html);
    });

    // Главная страница админки - возвращает HTML с проверкой авторизации на клиенте
    fastify.get('/', async (request, reply) => {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MP Proxy Admin</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { color: #4268F6; }
    .card { background: white; padding: 20px; margin: 10px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
    .stat-card { background: #4268F6; color: white; padding: 20px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 2em; font-weight: bold; }
    .nav { margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
    .nav-links a { margin-right: 15px; color: #4268F6; text-decoration: none; }
    .nav-links a:hover { text-decoration: underline; }
    .btn-logout { background: #dc3545; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; }
    .btn-logout:hover { background: #c82333; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #4268F6; color: white; }
    .btn { background: #4268F6; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; margin: 2px; }
    .btn:hover { background: #3355d4; }
    .btn-danger { background: #dc3545; }
    .btn-danger:hover { background: #c82333; }
    .btn-success { background: #28a745; }
    .btn-success:hover { background: #218838; }
    .btn-warning { background: #ffc107; color: #212529; }
    .btn-warning:hover { background: #e0a800; }
    .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); }
    .modal-content { background: white; margin: 5% auto; padding: 30px; border-radius: 12px; max-width: 500px; position: relative; }
    .close { position: absolute; right: 20px; top: 15px; font-size: 28px; cursor: pointer; color: #666; }
    .close:hover { color: #333; }
    .form-group { margin-bottom: 15px; }
    .form-group label { display: block; margin-bottom: 5px; font-weight: 500; color: #333; }
    .form-group input, .form-group select { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
    .form-group input:focus { outline: none; border-color: #4268F6; }
    .actions { margin-top: 20px; display: flex; gap: 10px; }
    .tabs { margin-bottom: 15px; }
    .tab { display: inline-block; padding: 10px 20px; background: #e9ecef; border-radius: 6px 6px 0 0; margin-right: 5px; cursor: pointer; }
    .tab.active { background: #4268F6; color: white; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <h1>MP Proxy Service - Admin Panel</h1>
    <div class="nav">
      <div class="nav-links">
        <a href="/admin">Dashboard</a>
        <a href="/docs">Swagger</a>
        <a href="/api/v1/health">Health</a>
      </div>
      <button class="btn-logout" onclick="logout()">Sign Out</button>
    </div>
    
    <div class="tabs">
      <div class="tab active" onclick="switchTab('dashboard')">Dashboard</div>
      <div class="tab" onclick="switchTab('clients')">Clients</div>
      <div class="tab" onclick="switchTab('tokens')">Tokens</div>
      <div class="tab" onclick="switchTab('requests')">Requests</div>
      <div class="tab" onclick="switchTab('logs')">Logs</div>
      <div class="tab" onclick="switchTab('authlogs')">Auth Logs</div>
      <div class="tab" onclick="switchTab('audit')">Audit</div>
    </div>
    
    <div id="dashboard" class="tab-content active"></div>
    <div id="clients" class="tab-content"></div>
    <div id="tokens" class="tab-content"></div>
    <div id="requests" class="tab-content"></div>
    <div id="logs" class="tab-content"></div>
    <div id="authlogs" class="tab-content"></div>
    <div id="audit" class="tab-content"></div>
  </div>
  
  <!-- Modal: Add Client -->
  <div id="addClientModal" class="modal">
    <div class="modal-content">
      <span class="close" onclick="closeModal('addClientModal')">&times;</span>
      <h2>Add New Client</h2>
      <form id="addClientForm">
        <div class="form-group">
          <label>Email *</label>
          <input type="email" id="clientEmail" required>
        </div>
        <div class="form-group">
          <label>Password *</label>
          <input type="password" id="clientPassword" required>
        </div>
        <div class="form-group">
          <label>Role</label>
          <select id="clientRole">
            <option value="client">Client</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div class="form-group">
          <label>Rate Tier</label>
          <select id="clientRateTier">
            <option value="basic">Basic</option>
            <option value="premium">Premium</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
        <div class="actions">
          <button type="submit" class="btn btn-success">Add Client</button>
          <button type="button" class="btn" onclick="closeModal('addClientModal')">Cancel</button>
        </div>
      </form>
    </div>
  </div>
  
  <script>
    function switchTab(tabName) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById(tabName).classList.add('active');
      
      if (tabName === 'clients') loadClients();
      else if (tabName === 'tokens') loadTokens();
      else if (tabName === 'requests') loadTable('requests');
      else if (tabName === 'logs') loadTable('logs');
      else if (tabName === 'authlogs') loadTable('auth_logs');
      else if (tabName === 'audit') loadTable('audit_logs');
      else if (tabName === 'dashboard') loadDashboard();
    }
    
    function openModal(id) { document.getElementById(id).style.display = 'block'; }
    function closeModal(id) { document.getElementById(id).style.display = 'none'; }
    window.onclick = function(e) { if (e.target.classList.contains('modal')) e.target.style.display = 'none'; }
    
    async function loadDashboard() {
      const res = await fetch('/admin/api/dashboard', {
        headers: { 'msapimp-key-api': 'Bearer ' + localStorage.getItem('access_token') }
      });
      if (!res.ok) { handleAuthError(); return; }
      const data = await res.json();
      document.getElementById('dashboard').innerHTML = \`
        <div class="stats">
          \${Object.entries(data.stats).map(([k, v]) => \`
            <div class="stat-card">
              <div class="stat-value">\${v}</div>
              <div>\${k}</div>
            </div>
          \`).join('')}
        </div>
        <div class="card" style="margin-top: 20px;">
          <h3>Uptime: \${(data.uptime / 3600).toFixed(2)} hours</h3>
        </div>
      \`;
    }
    
    async function loadClients() {
      const res = await fetch('/admin/api/clients', {
        headers: { 'msapimp-key-api': 'Bearer ' + localStorage.getItem('access_token') }
      });
      if (!res.ok) { handleAuthError(); return; }
      const data = await res.json();
      
      let html = \`<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
          <h3>Clients</h3>
          <button class="btn btn-success" onclick="openModal('addClientModal')">+ Add Client</button>
        </div>
        <table>
          <thead><tr><th>ID</th><th>Email</th><th>Role</th><th>Rate Tier</th><th>Active</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>\`;
      
      data.data.forEach(row => {
        html += \`<tr>
          <td>\${row.client_id}</td>
          <td>\${row.email}</td>
          <td>\${row.role}</td>
          <td>\${row.rate_tier}</td>
          <td>\${row.is_active ? 'Yes' : 'No'}</td>
          <td>\${row.created_at}</td>
          <td>
            <button class="btn btn-danger" onclick="deleteClient('\${row.client_id}')">Delete</button>
            <button class="btn btn-warning" onclick="toggleClientStatus('\${row.client_id}', \${row.is_active})">\${row.is_active ? 'Deactivate' : 'Activate'}</button>
          </td>
        </tr>\`;
      });
      
      html += \`</tbody></table></div>\`;
      document.getElementById('clients').innerHTML = html;
    }
    
    async function loadTokens() {
      const res = await fetch('/admin/api/access_tokens', {
        headers: { 'msapimp-key-api': 'Bearer ' + localStorage.getItem('access_token') }
      });
      if (!res.ok) { handleAuthError(); return; }
      const data = await res.json();

      let html = \`<div class="card">
        <h3>Access Tokens</h3>
        <table>
          <thead><tr><th>ID</th><th>Client ID</th><th>JTI</th><th>Expires At</th><th>Revoked</th><th>Actions</th></tr></thead>
          <tbody>\`;

      data.data.forEach(row => {
        html += \`<tr>
          <td>\${row.id}</td>
          <td>\${row.client_id}</td>
          <td>\${row.jti.substring(0, 8)}...</td>
          <td>\${row.expires_at}</td>
          <td>\${row.is_revoked ? 'Yes' : 'No'}</td>
          <td>
            <button class="btn btn-danger" onclick="revokeToken(\${row.id})">\${row.is_revoked ? 'Already Revoked' : 'Revoke'}</button>
            <button class="btn btn-danger" style="background:#6c757d;" onclick="deleteToken(\${row.id})">Delete</button>
          </td>
        </tr>\`;
      });

      html += \`</tbody></table></div>\`;
      document.getElementById('tokens').innerHTML = html;
    }

    async function loadTable(tableName) {
      const res = await fetch('/admin/api/' + tableName, {
        headers: { 'msapimp-key-api': 'Bearer ' + localStorage.getItem('access_token') }
      });
      if (!res.ok) { handleAuthError(); return; }
      const data = await res.json();

      if (!data.data || data.data.length === 0) {
        const divId = tableName === 'auth_logs' ? 'authlogs' : tableName === 'audit_logs' ? 'audit' : tableName;
        document.getElementById(divId).innerHTML = \`<div class="card"><h3>\${tableName.replace('_', ' ').toUpperCase()}</h3><p>No data available</p></div>\`;
        return;
      }

      const columns = Object.keys(data.data[0]);
      let html = \`<div class="card"><h3>\${tableName.replace('_', ' ').toUpperCase()}</h3>
        <div style="margin-bottom:10px;color:#666;">Total: \${data.total} records | Showing: \${data.data.length}</div>
        <table><thead><tr>\`;

      columns.forEach(col => { html += \`<th>\${col}</th>\`; });
      html += \`</tr></thead><tbody>\`;

      data.data.forEach(row => {
        html += \`<tr>\`;
        columns.forEach(col => {
          let val = row[col];
          if (val === null) val = '-';
          else if (typeof val === 'object') val = JSON.stringify(val).substring(0, 100) + '...';
          html += \`<td>\${val}</td>\`;
        });
        html += \`</tr>\`;
      });

      html += \`</tbody></table></div>\`;
      const divId = tableName === 'auth_logs' ? 'authlogs' : tableName === 'audit_logs' ? 'audit' : tableName;
      document.getElementById(divId).innerHTML = html;
    }

    // Add Client
    document.getElementById('addClientForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('clientEmail').value;
      const password = document.getElementById('clientPassword').value;
      const role = document.getElementById('clientRole').value;
      const rateTier = document.getElementById('clientRateTier').value;
      
      try {
        const res = await fetch('/admin/api/clients', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'msapimp-key-api': 'Bearer ' + localStorage.getItem('access_token')
          },
          body: JSON.stringify({ email, password, role, rate_tier: rateTier })
        });
        
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Failed to add client');
        }
        
        alert('Client added successfully!');
        closeModal('addClientModal');
        document.getElementById('addClientForm').reset();
        loadClients();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
    
    async function deleteClient(clientId) {
      if (!confirm('Are you sure you want to delete client: ' + clientId + '?')) return;

      try {
        const res = await fetch('/admin/api/clients/' + encodeURIComponent(clientId), {
          method: 'DELETE',
          headers: { 'msapimp-key-api': 'Bearer ' + localStorage.getItem('access_token') }
        });
        
        if (!res.ok) throw new Error('Failed to delete');
        alert('Client deleted');
        loadClients();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
    
    async function toggleClientStatus(clientId, isActive) {
      try {
        const res = await fetch('/admin/api/clients/' + encodeURIComponent(clientId) + '/status', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'msapimp-key-api': 'Bearer ' + localStorage.getItem('access_token')
          },
          body: JSON.stringify({ is_active: !isActive })
        });
        
        if (!res.ok) throw new Error('Failed to update status');
        loadClients();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
    
    async function revokeToken(tokenId) {
      if (!confirm('Are you sure you want to revoke this token?')) return;

      try {
        const res = await fetch('/admin/api/access_tokens/' + tokenId + '/revoke', {
          method: 'POST',
          headers: { 'msapimp-key-api': 'Bearer ' + localStorage.getItem('access_token') }
        });

        if (!res.ok) throw new Error('Failed to revoke');
        alert('Token revoked');
        loadTokens();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    async function deleteToken(tokenId) {
      if (!confirm('Are you sure you want to PERMANENTLY delete this token? This action cannot be undone!')) return;

      try {
        const res = await fetch('/admin/api/access_tokens/' + tokenId + '/delete', {
          method: 'DELETE',
          headers: { 'msapimp-key-api': 'Bearer ' + localStorage.getItem('access_token') }
        });

        if (!res.ok) throw new Error('Failed to delete');
        alert('Token permanently deleted');
        loadTokens();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
    
    function handleAuthError() {
      localStorage.clear();
      window.location.href = '/admin/login';
    }
    
    async function logout() {
      const accessToken = localStorage.getItem('access_token');
      try {
        await fetch('/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: accessToken })
        });
      } catch (e) {}
      localStorage.clear();
      window.location.href = '/admin/login';
    }
    
    // Init
    const token = localStorage.getItem('access_token');
    if (!token) {
      window.location.href = '/admin/login';
    } else {
      fetch('/auth/me', {
        headers: { 'msapimp-key-api': 'Bearer ' + token }
      }).then(res => {
        if (!res.ok) { handleAuthError(); return; }
        return res.json();
      }).then(data => {
        if (!data || data.role !== 'admin') { handleAuthError(); return; }
        loadDashboard();
      }).catch(() => { handleAuthError(); });
    }
  </script>
</body>
</html>
      `;
      reply.type('text/html').send(html);
    });

    // API: Добавить клиента
    fastify.post('/api/clients', { preHandler: [adminMiddleware] }, async (request, reply) => {
      const body = request.body as { email: string; password: string; role: string; rate_tier: string };
      
      if (!body.email || !body.password) {
        return reply.code(400).send({ message: 'Email and password are required' });
      }
      
      const bcrypt = await import('bcrypt');
      const { v4: uuidv4 } = await import('uuid');
      
      const existing = db.prepare('SELECT id FROM clients WHERE email = ?').get(body.email);
      if (existing) {
        return reply.code(400).send({ message: 'Email already exists' });
      }
      
      const clientId = 'client-' + uuidv4();
      const passwordHash = bcrypt.hashSync(body.password, 10);
      
      try {
        db.prepare(`
          INSERT INTO clients (client_id, email, password_hash, role, rate_tier)
          VALUES (?, ?, ?, ?, ?)
        `).run(clientId, body.email, passwordHash, body.role || 'client', body.rate_tier || 'basic');
        
        return { success: true, client_id: clientId };
      } catch (err) {
        return reply.code(500).send({ message: 'Failed to create client' });
      }
    });

    // API: Удалить клиента
    fastify.delete('/api/clients/:clientId', { preHandler: [adminMiddleware] }, async (request, reply) => {
      const params = request.params as { clientId: string };
      
      const client = db.prepare('SELECT id FROM clients WHERE client_id = ?').get(params.clientId);
      if (!client) {
        return reply.code(404).send({ message: 'Client not found' });
      }
      
      db.prepare('DELETE FROM clients WHERE client_id = ?').run(params.clientId);
      return { success: true };
    });

    // API: Изменить статус клиента
    fastify.put('/api/clients/:clientId/status', { preHandler: [adminMiddleware] }, async (request, reply) => {
      const params = request.params as { clientId: string };
      const body = request.body as { is_active: boolean };
      
      const client = db.prepare('SELECT id FROM clients WHERE client_id = ?').get(params.clientId);
      if (!client) {
        return reply.code(404).send({ message: 'Client not found' });
      }
      
      db.prepare('UPDATE clients SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ?')
        .run(body.is_active ? 1 : 0, params.clientId);
      
      return { success: true };
    });

    // API: Отозвать токен
    fastify.post('/api/access_tokens/:id/revoke', { preHandler: [adminMiddleware] }, async (request, reply) => {
      const params = request.params as { id: string };

      const token = db.prepare('SELECT id FROM access_tokens WHERE id = ?').get(params.id);
      if (!token) {
        return reply.code(404).send({ message: 'Token not found' });
      }

      db.prepare('UPDATE access_tokens SET is_revoked = 1 WHERE id = ?').run(params.id);
      return { success: true };
    });

    // API: Удалить токен (безвозвратно)
    fastify.delete('/api/access_tokens/:id/delete', { preHandler: [adminMiddleware] }, async (request, reply) => {
      const params = request.params as { id: string };

      const token = db.prepare('SELECT id FROM access_tokens WHERE id = ?').get(params.id);
      if (!token) {
        return reply.code(404).send({ message: 'Token not found' });
      }

      db.prepare('DELETE FROM access_tokens WHERE id = ?').run(params.id);
      return { success: true };
    });

    // Список ресурсов
    fastify.get('/api/resources', { preHandler: [adminMiddleware] }, async () => {
      return { resources };
    });

    // Получить данные из таблицы (исключая access_tokens)
    fastify.get('/api/:table', { preHandler: [adminMiddleware] }, async (request, reply) => {
      const params = request.params as { table: string };
      const query = request.query as { limit?: number; offset?: number };
      const limit = query.limit || 20;
      const offset = query.offset || 0;

      // access_tokens обрабатывается отдельным эндпоинтом
      if (params.table === 'access_tokens') {
        return reply.code(400).send({ error: 'Use /api/access_tokens endpoint instead' });
      }

      const resource = resources.find(r => r.tableName === params.table);
      if (!resource) {
        return reply.code(404).send({ error: 'Resource not found' });
      }

      const rows = db.prepare(`SELECT * FROM ${params.table} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`).all();
      const count = db.prepare(`SELECT COUNT(*) as count FROM ${params.table}`).get() as { count: number };

      return { data: rows, total: count.count };
    });
    
    // Получить запись по ID
    fastify.get('/api/:table/:id', { preHandler: [adminMiddleware] }, async (request, reply) => {
      const params = request.params as { table: string; id: string };

      const resource = resources.find(r => r.tableName === params.table);
      if (!resource) {
        return reply.code(404).send({ error: 'Resource not found' });
      }

      const row = db.prepare(`SELECT * FROM ${params.table} WHERE id = ?`).get(params.id);
      if (!row) {
        return reply.code(404).send({ error: 'Record not found' });
      }

      return { data: row };
    });

    // Специальный эндпоинт для access_tokens с email клиента
    fastify.get('/api/access_tokens', { preHandler: [adminMiddleware] }, async (request, reply) => {
      const query = request.query as { limit?: number; offset?: number };
      const limit = query.limit || 20;
      const offset = query.offset || 0;

      const rows = db.prepare(`
        SELECT 
          at.id,
          at.client_id,
          c.email,
          at.token_hash,
          at.jti,
          at.expires_at,
          at.is_revoked,
          at.created_at
        FROM access_tokens at
        LEFT JOIN clients c ON at.client_id = c.client_id
        ORDER BY at.id DESC
        LIMIT ${limit} OFFSET ${offset}
      `).all();
      const count = db.prepare(`SELECT COUNT(*) as count FROM access_tokens`).get() as { count: number };

      return { data: rows, total: count.count };
    });
    
    // Обновить запись
    fastify.put('/api/:table/:id', { preHandler: [adminMiddleware] }, async (request, reply) => {
      const params = request.params as { table: string; id: string };
      const body = request.body as Record<string, any>;
      
      const resource = resources.find(r => r.tableName === params.table);
      if (!resource) {
        return reply.code(404).send({ error: 'Resource not found' });
      }
      
      // Исключаем id и created_at из обновления
      const { id, created_at, ...updateData } = body;
      const columns = Object.keys(updateData).join(', ');
      const placeholders = Object.keys(updateData).map((_, i) => `?`).join(', ');
      const values = [...Object.values(updateData), params.id];
      
      db.prepare(`UPDATE ${params.table} SET ${columns} WHERE id = ?`).run(...values);
      
      const updated = db.prepare(`SELECT * FROM ${params.table} WHERE id = ?`).get(params.id);
      return { data: updated };
    });
    
    // Удалить запись
    fastify.delete('/api/:table/:id', { preHandler: [adminMiddleware] }, async (request, reply) => {
      const params = request.params as { table: string; id: string };
      
      const resource = resources.find(r => r.tableName === params.table);
      if (!resource) {
        return reply.code(404).send({ error: 'Resource not found' });
      }
      
      db.prepare(`DELETE FROM ${params.table} WHERE id = ?`).run(params.id);
      return { success: true };
    });
    
    // Статистика для дашборда
    fastify.get('/api/dashboard', { preHandler: [adminMiddleware] }, async () => {
      const tables = ['clients', 'requests', 'logs', 'auth_logs', 'access_tokens'];
      const stats: Record<string, number> = {};

      for (const table of tables) {
        const result = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
        stats[table] = result.count;
      }

      // Статус сервера
      return {
        stats,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      };
    });

    // Выход из админки
    fastify.post('/api/logout', async (request, reply) => {
      const body = request.body as { access_token?: string };
      if (body.access_token) {
        const { authService } = await import('./services/auth.service.js');
        await authService.logout(body.access_token);
      }
      reply.send({ success: true });
    });
  }, { prefix: '/admin' });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Graceful shutdown initiated...');

    // Остановка worker pool
    await queueService.stop();

    await fastify.close();
    closeDatabase();

    logger.info('Server closed');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return fastify;
}

async function start() {
  try {
    // Инициализация базы данных
    await initDatabase();
    logger.info('Database initialized');

    const fastify = await buildApp();

    // Запуск worker pool для обработки очереди
    queueService.start(4); // 4 воркера по умолчанию
    logger.info('Queue worker pool started with 4 workers');

    await fastify.listen({
      port: config.port,
      host: '0.0.0.0'
    });

    logger.info(`Server started at http://localhost:${config.port}`);
    logger.info(`Swagger UI: http://localhost:${config.port}/docs`);
    logger.info(`Admin Panel: http://localhost:${config.port}/admin`);
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error');
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

start();
