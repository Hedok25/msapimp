import express from 'express';
import cors from 'cors';
import { mockConfig } from './config.js';
import { WildberriesMock } from './mocks/wildberries.mock.js';
import { OzonMock } from './mocks/ozon.mock.js';

const app = express();
const PORT = process.env.MOCK_PORT || 3002;

app.use(cors());
app.use(express.json());

// Логирование всех запросов
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Middleware для симуляции задержек
app.use((req, res, next) => {
  const delay = mockConfig.baseDelay + Math.random() * mockConfig.randomDelay;
  setTimeout(next, delay);
});

// Middleware для симуляции ошибок (по сценарию)
app.use((req, res, next) => {
  const scenario = req.headers['x-mock-scenario'] || 'success';
  
  if (scenario === 'timeout') {
    return setTimeout(() => {
      res.socket.destroy();
    }, 30000);
  }
  
  if (scenario === 'error_500') {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
  
  if (scenario === 'error_429') {
    res.set('Retry-After', '60');
    return res.status(429).json({ 
      error: 'Too Many Requests',
      retry_after: 60 
    });
  }
  
  if (scenario === 'error_503') {
    return res.status(503).json({ error: 'Service Unavailable' });
  }
  
  next();
});

// ==================== WILDBERRIES ====================

// Orders endpoint
app.get('/api/v1/supplier/orders', WildberriesMock.getOrders);

// Products endpoint
app.get('/api/v1/supplier/products', WildberriesMock.getProducts);

// Stocks endpoint
app.get('/api/v1/supplier/stocks', WildberriesMock.getStocks);

// Card orders endpoint
app.get('/api/v1/supplier/cardorders', WildberriesMock.getCardOrders);

// Returns endpoint
app.get('/api/v1/supplier/returns', WildberriesMock.getReturns);

// ==================== OZON ====================

// Posting list endpoint
app.post('/v3/posting/fbs/list', OzonMock.getPostingList);

// Posting get endpoint
app.post('/v3/posting/fbs/get', OzonMock.getPosting);

// Products endpoint
app.post('/v1/product/list', OzonMock.getProducts);

// Stocks endpoint
app.post('/v1/product/info/stocks', OzonMock.getStocks);

// ==================== ОБЩИЕ ENDPOINTS ====================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mock: true
  });
});

// Сценарии для тестирования
app.get('/scenarios', (req, res) => {
  res.json({
    available: mockConfig.scenarios,
    usage: 'Set header X-Mock-Scenario: <scenario_name>'
  });
});

// Обработка 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.path} not found in mock API`
  });
});

// Запуск сервера с обработкой ошибки порта
const server = app.listen(PORT, () => {
  console.log(`\n🎭 Mock MP API started on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  console.log(`🎬 Scenarios: http://localhost:${PORT}/scenarios`);
  console.log(`\nAvailable scenarios: ${mockConfig.scenarios.join(', ')}`);
  console.log(`\nWildberries API: http://localhost:${PORT}/api/v1/supplier/*`);
  console.log(`Ozon API: http://localhost:${PORT}/v3/*, /v1/*\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use.`);
    console.error(`\nSolutions:`);
    console.error(`  1. Stop the process using port ${PORT}:`);
    console.error(`     Windows: netstat -ano | findstr :${PORT}  →  taskkill /PID <PID> /F`);
    console.error(`     Linux/Mac: lsof -i :${PORT}  →  kill -9 <PID>`);
    console.error(`\n  2. Or use a different port:`);
    console.error(`     MOCK_PORT=${parseInt(PORT) + 1} npm run mock:start`);
    console.error(`\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
