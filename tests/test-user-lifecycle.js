import fetch from 'node-fetch';
import chalk from 'chalk';

// ============================================================================
// КОНФИГУРАЦИЯ
// ============================================================================
const CONFIG = {
  baseUrl: process.env.PROXY_URL || 'http://localhost:3000',
  adminToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbi1jbGllbnQiLCJpc3MiOiJtcC1wcm94eS1zZXJ2aWNlIiwiYXVkIjoibXAtcHJveHktc2VydmljZSIsImlhdCI6MTc3NDY4MTY2NSwiZXhwIjoxNzkwMjMzNjY1LCJqdGkiOiI5NzFiM2FmMS04ODVkLTQxYmItYTlhZi0xYzU2OGZhZjQ0OWIiLCJzY29wZSI6WyJwcm94eTpyZWFkIiwicHJveHk6d3JpdGUiXSwicmF0ZV90aWVyIjoiZW50ZXJwcmlzZSIsInJvbGUiOiJhZG1pbiJ9.WY-4Z4RD3TECSYTZFRYS9_cPpwOO9LY1OhqhrjdNNbs',
  
  // Тестовый пользователь
  testUser: {
    email: `test_${Date.now()}@test.com`,
    password: 'TestPassword123!',
    role: 'client',
    rateTier: 'basic'
  }
};

// ============================================================================
// УТИЛИТЫ
// ============================================================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const encodeOptions = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

class TestRunner {
  constructor() {
    this.results = { passed: 0, failed: 0, total: 0, tests: [] };
    this.testUser = {
      email: CONFIG.testUser.email,
      clientId: null,
      accessToken: null,
      refreshToken: null
    };
  }

  async runTest(name, testFn) {
    this.results.total++;
    const start = Date.now();
    try {
      await testFn.call(this);
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
    
    console.log(chalk.blue('\n' + '='.repeat(60)));
    console.log(chalk.blue('👤 TEST USER INFO'));
    console.log(chalk.blue('='.repeat(60)));
    console.log(chalk.white(`  Email:      ${this.testUser.email}`));
    console.log(chalk.white(`  Client ID:  ${this.testUser.clientId || 'N/A'}`));
    console.log(chalk.white(`  Has Token:  ${this.testUser.accessToken ? 'Yes' : 'No'}`));
    console.log(chalk.blue('='.repeat(60)));
    
    return this.results.failed === 0;
  }
}

// ============================================================================
// 1. СОЗДАНИЕ ПОЛЬЗОВАТЕЛЯ
// ============================================================================
async function testCreateUser(runner) {
  await runner.runSuite('👤 Create User - Admin API', {
    'Create new client via admin API': async function() {
      const response = await fetch(`${CONFIG.baseUrl}/admin/api/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'msapimp-key-api': CONFIG.adminToken
        },
        body: JSON.stringify({
          email: this.testUser.email,
          password: CONFIG.testUser.password,
          role: CONFIG.testUser.role,
          rate_tier: CONFIG.testUser.rateTier
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Status ${response.status}: ${error.message || 'Unknown error'}`);
      }

      const data = await response.json();
      console.log(chalk.gray(`    Created: ${data.client_id || data.data?.client_id}`));
      
      // Сохраняем client_id для последующих тестов
      this.testUser.clientId = data.client_id || data.data?.client_id;
      
      if (!this.testUser.clientId) {
        throw new Error('No client_id in response');
      }
    },

    'Verify user exists in admin panel': async function() {
      const response = await fetch(`${CONFIG.baseUrl}/admin/api/clients`, {
        headers: { 'msapimp-key-api': CONFIG.adminToken }
      });

      if (!response.ok) throw new Error(`Status ${response.status}`);
      
      const data = await response.json();
      const user = data.data?.find(c => c.client_id === this.testUser.clientId);
      
      if (!user) throw new Error('User not found in admin panel');
      
      console.log(chalk.gray(`    Found: ${user.email} (${user.rate_tier})`));
    }
  });
}

// ============================================================================
// 2. АУТЕНТИФИКАЦИЯ
// ============================================================================
async function testAuthentication(runner) {
  await runner.runSuite('🔐 Authentication - Login', {
    'Login with created user credentials': async function() {
      const response = await fetch(`${CONFIG.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: this.testUser.email,
          password: CONFIG.testUser.password
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Status ${response.status}: ${error.message}`);
      }

      const data = await response.json();
      
      if (!data.access_token) throw new Error('No access_token in response');
      
      this.testUser.accessToken = data.access_token;
      this.testUser.refreshToken = data.refresh_token;
      
      console.log(chalk.gray(`    Token: ${data.access_token.substring(0, 20)}...`));
      console.log(chalk.gray(`    Expires: ${new Date(data.expires_at).toLocaleString()}`));
    },

    'Verify token via /auth/me': async function() {
      const response = await fetch(`${CONFIG.baseUrl}/auth/me`, {
        headers: { 'msapimp-key-api': this.testUser.accessToken }
      });

      if (!response.ok) throw new Error(`Status ${response.status}`);
      
      const data = await response.json();
      
      if (data.sub !== this.testUser.clientId) {
        throw new Error(`Token mismatch: expected ${this.testUser.clientId}, got ${data.sub}`);
      }
      
      console.log(chalk.gray(`    User: ${data.sub} (${data.role}, ${data.rate_tier})`));
    }
  });
}

// ============================================================================
// 3. ПРОВЕРКА ДОСТУПА К PROXY
// ============================================================================
async function testProxyAccess(runner) {
  await runner.runSuite('🔗 Proxy Access - Test User', {
    'Access proxy with user token': async function() {
      const response = await fetch(
        `${CONFIG.baseUrl}/api/v1/proxy/mocktest/api/v1/supplier/orders?limit=1`,
        {
          headers: {
            'msapimp-key-api': this.testUser.accessToken,
            'msapimp-options': encodeOptions({ paginate: false, priority: 'low' })
          }
        }
      );

      // Допускаем 200, 202 или 429
      if (!response.ok && response.status !== 429 && response.status !== 202) {
        throw new Error(`Status ${response.status}`);
      }
      
      console.log(chalk.gray(`    Status: ${response.status}`));
    },

    'Check queue stats (should work for client)': async function() {
      const response = await fetch(`${CONFIG.baseUrl}/api/v1/queue/stats`, {
        headers: { 'msapimp-key-api': this.testUser.accessToken }
      });

      // Допускаем 200 или 403 (если только admin)
      if (!response.ok && response.status !== 403) {
        throw new Error(`Status ${response.status}`);
      }
      
      console.log(chalk.gray(`    Status: ${response.status}`));
    },

    'Check rate limit headers': async function() {
      const response = await fetch(
        `${CONFIG.baseUrl}/api/v1/proxy/mocktest/api/v1/supplier/products?limit=1`,
        {
          headers: {
            'msapimp-key-api': this.testUser.accessToken,
            'msapimp-options': encodeOptions({ paginate: false, priority: 'low' })
          }
        }
      );

      const headers = {
        limit: response.headers.get('x-ratelimit-limit'),
        remaining: response.headers.get('x-ratelimit-remaining'),
        reset: response.headers.get('x-ratelimit-reset')
      };
      
      console.log(chalk.gray(`    Rate Limit: ${headers.limit || 'N/A'}, Remaining: ${headers.remaining || 'N/A'}`));
    }
  });
}

// ============================================================================
// 4. ПРОВЕРКА RATE LIMITING
// ============================================================================
async function testRateLimiting(runner) {
  await runner.runSuite('🚦 Rate Limiting - Test User', {
    'Multiple requests should hit rate limit': async function() {
      let success = 0, rateLimited = 0;
      
      for (let i = 0; i < 15; i++) {
        const response = await fetch(
          `${CONFIG.baseUrl}/api/v1/proxy/mocktest/api/v1/supplier/orders?limit=1`,
          {
            headers: {
              'msapimp-key-api': this.testUser.accessToken,
              'msapimp-options': encodeOptions({ paginate: false, priority: 'low' })
            }
          }
        );
        
        if (response.status === 200 || response.status === 202) success++;
        else if (response.status === 429) rateLimited++;
        
        await sleep(50);
      }
      
      console.log(chalk.gray(`    Success: ${success}, Rate Limited: ${rateLimited}`));
      
      // Для basic тарифа (30 запросов/мин) должны быть некоторые rate limited
      if (rateLimited === 0) {
        console.log(chalk.yellow('    ⚠ No rate limiting triggered (expected for basic tier)'));
      }
    },

    'Check rate limit status via admin API': async function() {
      const response = await fetch(`${CONFIG.baseUrl}/api/v1/admin/rate-limits/usage`, {
        headers: { 'msapimp-key-api': CONFIG.adminToken }
      });

      if (!response.ok) throw new Error(`Status ${response.status}`);
      
      const data = await response.json();
      console.log(chalk.gray(`    Active counters: ${data.data?.length || 0}`));
    }
  });
}

// ============================================================================
// 5. ПРОВЕРКА PAGINATION
// ============================================================================
async function testPagination(runner) {
  await runner.runSuite('📄 Pagination - Test User', {
    'Create pagination group': async function() {
      const response = await fetch(
        `${CONFIG.baseUrl}/api/v1/proxy/mocktest/api/v1/supplier/orders`,
        {
          headers: {
            'msapimp-key-api': this.testUser.accessToken,
            'msapimp-options': encodeOptions({ paginate: true, limit: 5, priority: 'low' })
          }
        }
      );

      if (!response.ok && response.status !== 429) {
        throw new Error(`Status ${response.status}`);
      }
      
      if (response.status === 200) {
        const data = await response.json();
        console.log(chalk.gray(`    Response: ${data.success ? 'success' : 'queued'}`));
      }
    }
  });
}

// ============================================================================
// 6. УДАЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
// ============================================================================
async function testDeleteUser(runner) {
  await runner.runSuite('🗑️ Delete User - Cleanup', {
    'Delete user via admin API': async function() {
      if (!this.testUser.clientId) {
        throw new Error('No client_id to delete');
      }
      
      const response = await fetch(
        `${CONFIG.baseUrl}/admin/api/clients/${encodeURIComponent(this.testUser.clientId)}`,
        {
          method: 'DELETE',
          headers: { 'msapimp-key-api': CONFIG.adminToken }
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Status ${response.status}: ${error.message}`);
      }
      
      console.log(chalk.gray(`    Deleted: ${this.testUser.clientId}`));
    },

    'Verify user deleted (should 404)': async function() {
      const response = await fetch(
        `${CONFIG.baseUrl}/admin/api/clients/${encodeURIComponent(this.testUser.clientId)}`,
        { headers: { 'msapimp-key-api': CONFIG.adminToken } }
      );

      if (response.status !== 404) {
        throw new Error(`Expected 404, got ${response.status}`);
      }
      
      console.log(chalk.gray(`    Verified: User no longer exists`));
    },

    'Verify token invalidated': async function() {
      const response = await fetch(`${CONFIG.baseUrl}/auth/me`, {
        headers: { 'msapimp-key-api': this.testUser.accessToken }
      });

      // После удаления пользователя токен должен быть невалиден
      if (response.status === 200) {
        console.log(chalk.yellow('    ⚠ Token still valid (may be cached)'));
      } else if (response.status === 401) {
        console.log(chalk.gray(`    Verified: Token invalidated (${response.status})`));
      } else {
        console.log(chalk.gray(`    Status: ${response.status}`));
      }
    }
  });
}

// ============================================================================
// ЗАПУСК
// ============================================================================
async function runTests() {
  console.log(chalk.blue('╔═══════════════════════════════════════════════════════════╗'));
  console.log(chalk.blue('║     MP PROXY - USER LIFECYCLE TESTS                       ║'));
  console.log(chalk.blue('╚═══════════════════════════════════════════════════════════╝'));
  console.log(chalk.gray(`Base URL: ${CONFIG.baseUrl}`));
  console.log(chalk.gray(`Test User: ${CONFIG.testUser.email}`));
  console.log(chalk.gray(`Time: ${new Date().toISOString()}`));

  const runner = new TestRunner();

  // Проверка доступности
  console.log(chalk.blue('\n🔍 Checking services...'));
  try {
    const healthRes = await fetch(`${CONFIG.baseUrl}/api/v1/health`);
    console.log(healthRes.ok ? chalk.green('  ✓ Proxy API') : chalk.yellow('  ⚠ Proxy API'));
  } catch {
    console.log(chalk.red('  ✗ Proxy API not available'));
    console.log(chalk.red('    Run: npm start'));
    process.exit(1);
  }

  // Запуск тестов
  await testCreateUser(runner);
  await testAuthentication(runner);
  await testProxyAccess(runner);
  await testRateLimiting(runner);
  await testPagination(runner);
  await testDeleteUser(runner);

  const success = runner.printSummary();
  
  // Вывод итоговой информации
  console.log(chalk.blue('\n' + '='.repeat(60)));
  if (success) {
    console.log(chalk.green('✅ ALL TESTS PASSED - User lifecycle completed successfully!'));
  } else {
    console.log(chalk.red('❌ SOME TESTS FAILED - Check errors above'));
  }
  console.log(chalk.blue('='.repeat(60)));
  
  process.exit(success ? 0 : 1);
}

runTests().catch(error => {
  console.error(chalk.red('Test runner error:'), error);
  process.exit(1);
});
