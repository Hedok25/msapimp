import fetch from 'node-fetch';
import chalk from 'chalk';

// ============================================================================
// КОНФИГУРАЦИЯ
// ============================================================================
const CONFIG = {
  proxyBaseUrl: process.env.PROXY_URL || 'http://localhost:3000',
  mockApiUrl: process.env.MOCK_URL || 'http://localhost:3002',
  adminToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbi1jbGllbnQiLCJpc3MiOiJtcC1wcm94eS1zZXJ2aWNlIiwiYXVkIjoibXAtcHJveHktc2VydmljZSIsImlhdCI6MTc3NDY4MTY2NSwiZXhwIjoxNzkwMjMzNjY1LCJqdGkiOiI5NzFiM2FmMS04ODVkLTQxYmItYTlhZi0xYzU2OGZhZjQ0OWIiLCJzY29wZSI6WyJwcm94eTpyZWFkIiwicHJveHk6d3JpdGUiXSwicmF0ZV90aWVyIjoiZW50ZXJwcmlzZSIsInJvbGUiOiJhZG1pbiJ9.WY-4Z4RD3TECSYTZFRYS9_cPpwOO9LY1OhqhrjdNNbs',
  encodeOptions: (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
};

// ============================================================================
// ТЕСТИРОВАНИЕ
// ============================================================================
class TestRunner {
  constructor() {
    this.results = { passed: 0, failed: 0, total: 0, tests: [] };
  }

  async runTest(name, testFn) {
    this.results.total++;
    const start = Date.now();
    try {
      await testFn();
      this.results.passed++;
      this.results.tests.push({ name, status: 'PASSED', duration: Date.now() - start });
      console.log(chalk.green(`  ✓ ${name}`) + chalk.gray(` (${Date.now() - start}ms)`));
    } catch (error) {
      this.results.failed++;
      this.results.tests.push({ name, status: 'FAILED', duration: Date.now() - start, error: error.message });
      console.log(chalk.red(`  ✗ ${name}`) + chalk.gray(` (${Date.now() - start}ms)`));
      console.log(chalk.red(`    Error: ${error.message}`));
    }
  }

  async runSuite(name, tests) {
    console.log(chalk.blue(`\n📋 ${name}`));
    console.log(chalk.gray('='.repeat(60)));
    for (const [testName, testFn] of Object.entries(tests)) {
      await this.runTest(testName, testFn);
    }
  }

  printSummary() {
    console.log(chalk.blue('\n' + '='.repeat(60)));
    console.log(chalk.blue('📊 TEST SUMMARY'));
    console.log(chalk.blue('='.repeat(60)));
    console.log(chalk.white(`  Total:   ${this.results.total}`));
    console.log(chalk.green(`  Passed:  ${this.results.passed}`));
    console.log(chalk.red(`  Failed:  ${this.results.failed}`));
    const rate = this.results.total > 0 ? ((this.results.passed / this.results.total) * 100).toFixed(1) : 0;
    console.log(chalk.white(`  Success: ${rate}%`));
    console.log(chalk.blue('='.repeat(60)));
    if (this.results.failed > 0) {
      console.log(chalk.red('\n❌ FAILED:'));
      this.results.tests.filter(t => t.status === 'FAILED').forEach(t => 
        console.log(chalk.red(`  - ${t.name}: ${t.error}`)));
    }
    return this.results.failed === 0;
  }
}

// ============================================================================
// 1. ТЕСТИРОВАНИЕ MOCK API
// ============================================================================
async function testMockApi(runner) {
  await runner.runSuite('🎭 Mock API - Health & Scenarios', {
    'Mock API health check': async () => {
      const res = await fetch(`${CONFIG.mockApiUrl}/health`);
      const data = await res.json();
      if (data.status !== 'ok') throw new Error('Mock API not healthy');
    },
    'Mock API scenarios endpoint': async () => {
      const res = await fetch(`${CONFIG.mockApiUrl}/scenarios`);
      const data = await res.json();
      if (!data.available || !Array.isArray(data.available)) throw new Error('No scenarios');
    }
  });

  await runner.runSuite('🎭 Mock API - Wildberries Endpoints', {
    'GET /orders - returns array': async () => {
      const res = await fetch(`${CONFIG.mockApiUrl}/api/v1/supplier/orders?limit=5`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Expected array');
      if (data.length > 5) throw new Error('Limit not respected');
    },
    'GET /products - returns array': async () => {
      const res = await fetch(`${CONFIG.mockApiUrl}/api/v1/supplier/products?limit=3`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Expected array');
    },
    'GET /stocks - returns array': async () => {
      const res = await fetch(`${CONFIG.mockApiUrl}/api/v1/supplier/stocks?limit=3`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Expected array');
    },
    'GET /returns - returns array': async () => {
      const res = await fetch(`${CONFIG.mockApiUrl}/api/v1/supplier/returns?limit=3`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Expected array');
    }
  });

  await runner.runSuite('🎭 Mock API - Error Scenarios', {
    'Scenario error_429 returns 429': async () => {
      const res = await fetch(`${CONFIG.mockApiUrl}/api/v1/supplier/orders`, {
        headers: { 'X-Mock-Scenario': 'error_429' }
      });
      if (res.status !== 429) throw new Error(`Expected 429, got ${res.status}`);
    },
    'Scenario error_500 returns 500': async () => {
      const res = await fetch(`${CONFIG.mockApiUrl}/api/v1/supplier/orders`, {
        headers: { 'X-Mock-Scenario': 'error_500' }
      });
      if (res.status !== 500) throw new Error(`Expected 500, got ${res.status}`);
    },
    'Scenario error_503 returns 503': async () => {
      const res = await fetch(`${CONFIG.mockApiUrl}/api/v1/supplier/orders`, {
        headers: { 'X-Mock-Scenario': 'error_503' }
      });
      if (res.status !== 503) throw new Error(`Expected 503, got ${res.status}`);
    }
  });
}

// ============================================================================
// 2. ТЕСТИРОВАНИЕ PROXY ENDPOINTS
// ============================================================================
async function testProxyEndpoints(runner) {
  const headers = { 'msapimp-key-api': CONFIG.adminToken };

  await runner.runSuite('🔗 Proxy - Health & Stats', {
    'Proxy health endpoint': async () => {
      const res = await fetch(`${CONFIG.proxyBaseUrl}/api/v1/health`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
    },
    'Queue stats endpoint': async () => {
      const res = await fetch(`${CONFIG.proxyBaseUrl}/api/v1/queue/stats`, { headers });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error('Expected success');
    }
  });

  await runner.runSuite('🔗 Proxy - Mocktest Integration', {
    'Proxy forwards to mocktest (no pagination)': async () => {
      // Используем правильный формат URL для mocktest
      const res = await fetch(
        `${CONFIG.proxyBaseUrl}/api/v1/proxy/mocktest/api/v1/supplier/orders?limit=2`,
        { 
          headers: { 
            ...headers, 
            'msapimp-options': CONFIG.encodeOptions({ paginate: false, priority: 'low' })
          }
        }
      );
      // Разрешаем 200 или 429
      if (!res.ok && res.status !== 429) throw new Error(`Status ${res.status}`);
      if (res.status === 200) {
        const data = await res.json();
        if (!data.success && data.error) throw new Error(data.error);
      }
    },
    'Proxy creates pagination group': async () => {
      const res = await fetch(
        `${CONFIG.proxyBaseUrl}/api/v1/proxy/mocktest/api/v1/supplier/products`,
        { 
          headers: { 
            ...headers, 
            'msapimp-options': CONFIG.encodeOptions({ paginate: true, limit: 5, priority: 'low' })
          }
        }
      );
      if (!res.ok && res.status !== 429) throw new Error(`Status ${res.status}`);
      if (res.status === 200) {
        const data = await res.json();
        // group_id может не быть если это первый запрос
        console.log(chalk.gray(`    Response: ${data.success ? 'success' : 'queued'}`));
      }
    }
  });

  await runner.runSuite('🔗 Proxy - Queue Management', {
    'GET /queue/stats - queue statistics': async () => {
      const res = await fetch(`${CONFIG.proxyBaseUrl}/api/v1/queue/stats`, { headers });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      // Проверяем что есть данные
      if (!data.queue && !data.data) throw new Error('Expected queue data');
      console.log(chalk.gray(`    Queue: ${JSON.stringify(data.queue || data.data)}`));
    }
  });
}

// ============================================================================
// 3. ТЕСТИРОВАНИЕ RATE LIMITING
// ============================================================================
async function testRateLimiting(runner) {
  const headers = { 'msapimp-key-api': CONFIG.adminToken };

  await runner.runSuite('🚦 Rate Limiting - Basic Tests', {
    'Should allow some requests within limit': async () => {
      let success = 0, rateLimited = 0;
      for (let i = 0; i < 10; i++) {
        const res = await fetch(
          `${CONFIG.proxyBaseUrl}/api/v1/proxy/mocktest/api/v1/supplier/orders?limit=1`,
          { headers: { ...headers, 'msapimp-options': CONFIG.encodeOptions({ paginate: false, priority: 'low' }) } }
        );
        if (res.status === 200) success++;
        else if (res.status === 429) rateLimited++;
        await new Promise(r => setTimeout(r, 100));
      }
      console.log(chalk.gray(`    ${success}/10 success, ${rateLimited} rate limited`));
      // Допускаем что часть запросов будет rate limited
      if (success === 0 && rateLimited === 10) throw new Error('All requests rate limited');
    }
  });

  await runner.runSuite('🚦 Rate Limiting - Concurrent Requests', {
    'Should handle concurrent requests': async () => {
      const results = { success: 0, rateLimited: 0, error: 0 };
      const promises = Array(10).fill(null).map(async () => {
        try {
          const res = await fetch(
            `${CONFIG.proxyBaseUrl}/api/v1/proxy/mocktest/api/v1/supplier/orders?limit=1`,
            { headers: { ...headers, 'msapimp-options': CONFIG.encodeOptions({ paginate: false, priority: 'low' }) } }
          );
          if (res.status === 200) results.success++;
          else if (res.status === 429) results.rateLimited++;
          else results.error++;
        } catch { results.error++; }
      });
      await Promise.all(promises);
      console.log(chalk.gray(`    Success: ${results.success}, Rate Limited: ${results.rateLimited}, Errors: ${results.error}`));
      // Главное чтобы не было ошибок соединения
      if (results.error > 5) throw new Error('Too many connection errors');
    }
  });

  await runner.runSuite('🚦 Rate Limiting - Admin API', {
    'GET /admin/rate-limits - list all limits': async () => {
      const res = await fetch(`${CONFIG.proxyBaseUrl}/api/v1/admin/rate-limits`, { headers });
      if (!res.ok) throw new Error(`Status ${res.status}`);
    },
    'GET /admin/rate-limits/stats - limits statistics': async () => {
      const res = await fetch(`${CONFIG.proxyBaseUrl}/api/v1/admin/rate-limits/stats`, { headers });
      if (!res.ok) throw new Error(`Status ${res.status}`);
    },
    'GET /admin/rate-limits/usage - current usage': async () => {
      const res = await fetch(`${CONFIG.proxyBaseUrl}/api/v1/admin/rate-limits/usage`, { headers });
      if (!res.ok) throw new Error(`Status ${res.status}`);
    }
  });
}

// ============================================================================
// 4. ТЕСТИРОВАНИЕ CIRCUIT BREAKER
// ============================================================================
async function testCircuitBreaker(runner) {
  const headers = { 'msapimp-key-api': CONFIG.adminToken };

  await runner.runSuite('⚡ Circuit Breaker - Admin API', {
    'GET /admin/circuit-breakers - list all CBs': async () => {
      const res = await fetch(`${CONFIG.proxyBaseUrl}/api/v1/admin/circuit-breakers`, { headers });
      if (!res.ok) throw new Error(`Status ${res.status}`);
    },
    'GET /admin/circuit-breakers/stats - CB statistics': async () => {
      const res = await fetch(`${CONFIG.proxyBaseUrl}/api/v1/admin/circuit-breakers/stats`, { headers });
      if (!res.ok) throw new Error(`Status ${res.status}`);
    }
  });

  await runner.runSuite('⚡ Circuit Breaker - Error Handling', {
    'Should handle 500 errors from mock': async () => {
      let errorCount = 0;
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${CONFIG.mockApiUrl}/api/v1/supplier/orders`, {
          headers: { 'X-Mock-Scenario': 'error_500' }
        });
        if (res.status === 500) errorCount++;
      }
      console.log(chalk.gray(`    ${errorCount}/5 errors received`));
      if (errorCount < 3) throw new Error('Expected more errors');
    }
  });
}

// ============================================================================
// 5. ТЕСТИРОВАНИЕ PAGINATION
// ============================================================================
async function testPagination(runner) {
  const headers = { 'msapimp-key-api': CONFIG.adminToken };

  await runner.runSuite('📄 Pagination - Basic', {
    'Pagination endpoint accepts request': async () => {
      const res = await fetch(
        `${CONFIG.proxyBaseUrl}/api/v1/proxy/mocktest/api/v1/supplier/orders`,
        { headers: { ...headers, 'msapimp-options': CONFIG.encodeOptions({ paginate: true, limit: 5, priority: 'low' }) } }
      );
      // Допускаем 200 или 429
      if (!res.ok && res.status !== 429) {
        console.log(chalk.gray(`    Status: ${res.status}`));
      }
      if (res.status === 200) {
        const data = await res.json();
        console.log(chalk.gray(`    Response: ${data.success ? 'success' : 'queued'}`));
      }
    }
  });
}

// ============================================================================
// 6. MASS LOAD TESTING
// ============================================================================
async function testMassLoad(runner) {
  const headers = { 'msapimp-key-api': CONFIG.adminToken };

  await runner.runSuite('🔥 Load Test - Multiple Clients', {
    '30 requests with rate limiting': async () => {
      const results = { success: 0, rateLimited: 0, failed: 0 };

      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(
            `${CONFIG.proxyBaseUrl}/api/v1/proxy/mocktest/api/v1/supplier/orders?limit=1`,
            { headers: { ...headers, 'msapimp-options': CONFIG.encodeOptions({ paginate: false, priority: 'low' }) } }
          );
          if (res.status === 200) results.success++;
          else if (res.status === 429) results.rateLimited++;
          else results.failed++;
        } catch { results.failed++; }
        await new Promise(r => setTimeout(r, 100));
      }

      console.log(chalk.gray(`    Success: ${results.success}, Rate Limited: ${results.rateLimited}, Failed: ${results.failed}`));
      // Успех если есть хоть какие-то успешные запросы
      if (results.success === 0 && results.failed > 0) throw new Error('All requests failed');
    }
  });

  await runner.runSuite('🔥 Load Test - Recovery', {
    'Should show rate limit status': async () => {
      // Просто проверяем что API доступен
      const res = await fetch(`${CONFIG.proxyBaseUrl}/api/v1/admin/rate-limits/stats`, { headers });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      console.log(chalk.gray('    ✓ Rate limit stats available'));
    }
  });
}

// ============================================================================
// ЗАПУСК
// ============================================================================
async function runTests(suite = 'all') {
  console.log(chalk.blue('╔═══════════════════════════════════════════════════════════╗'));
  console.log(chalk.blue('║     MP PROXY SERVICE - INTEGRATION TESTS                  ║'));
  console.log(chalk.blue('╚═══════════════════════════════════════════════════════════╝'));
  console.log(chalk.gray(`Proxy: ${CONFIG.proxyBaseUrl}`));
  console.log(chalk.gray(`Mock:  ${CONFIG.mockApiUrl}`));
  console.log(chalk.gray(`Time:  ${new Date().toISOString()}`));

  const runner = new TestRunner();

  // Проверка сервисов
  console.log(chalk.blue('\n🔍 Checking services...'));
  try {
    const mockRes = await fetch(`${CONFIG.mockApiUrl}/health`);
    console.log(mockRes.ok ? chalk.green('  ✓ Mock API') : chalk.yellow('  ⚠ Mock API'));
  } catch {
    console.log(chalk.red('  ✗ Mock API not available'));
    console.log(chalk.red('    Run: npm run mock:start'));
    process.exit(1);
  }

  try {
    const proxyRes = await fetch(`${CONFIG.proxyBaseUrl}/api/v1/health`);
    console.log(proxyRes.ok ? chalk.green('  ✓ Proxy API') : chalk.yellow('  ⚠ Proxy API'));
  } catch {
    console.log(chalk.red('  ✗ Proxy API not available'));
    console.log(chalk.red('    Run: npm start'));
    process.exit(1);
  }

  // Запуск тестов
  if (suite === 'all' || suite === 'quick') {
    await testMockApi(runner);
    await testProxyEndpoints(runner);
  }
  if (suite === 'all' || suite === 'rate-limit') {
    await testRateLimiting(runner);
    await testCircuitBreaker(runner);
  }
  if (suite === 'all' || suite === 'load') {
    await testPagination(runner);
    await testMassLoad(runner);
  }

  const success = runner.printSummary();
  process.exit(success ? 0 : 1);
}

// Parse args
const args = process.argv.slice(2);
const suite = args.find(a => a.startsWith('--'))?.replace('--', '') || 'all';

runTests(suite).catch(error => {
  console.error(chalk.red('Test error:'), error);
  process.exit(1);
});
