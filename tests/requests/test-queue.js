/**
 * Тесты для проверки работы очереди запросов
 * Использование: node tests/requests/test-queue.js
 */

import axios from 'axios';

const BASE_URL = 'http://localhost:3000';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbi1jbGllbnQiLCJpc3MiOiJtcC1wcm94eS1zZXJ2aWNlIiwiYXVkIjoibXAtcHJveHktc2VydmljZSIsImlhdCI6MTc3NDY4MTY2NSwiZXhwIjoxNzkwMjMzNjY1LCJqdGkiOiI5NzFiM2FmMS04ODVkLTQxYmItYTlhZi0xYzU2OGZhZjQ0OWIiLCJzY29wZSI6WyJwcm94eTpyZWFkIiwicHJveHk6d3JpdGUiXSwicmF0ZV90aWVyIjoiZW50ZXJwcmlzZSIsInJvbGUiOiJhZG1pbiJ9.WY-4Z4RD3TECSYTZFRYS9_cPpwOO9LY1OhqhrjdNNbs';

const headers = {
  'msapimp-key-api': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json'
};

// Вспомогательная функция для выполнения запросов
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;

  const config = {
    method: options.method || 'GET',
    url,
    headers: {
      ...headers,
      ...options.headers
    },
    data: options.body || undefined
  };

  console.log(`\n📤 ${config.method} ${url}`);

  try {
    const response = await axios(config);
    console.log(`✅ Ответ ${response.status}:`, JSON.stringify(response.data, null, 2).substring(0, 500));
    return response.data;
  } catch (error) {
    const status = error.response?.status || 'Unknown';
    const message = error.response?.data?.message || error.message;
    console.error(`❌ Ошибка ${status}:`, message);
    throw new Error(`HTTP ${status}: ${message}`);
  }
}

// Тест 1: Проверка статистики очереди
async function testQueueStats() {
  console.log('\n=== ТЕСТ 1: Проверка статистики очереди ===');

  const data = await request('/api/v1/queue/stats');

  console.log('📊 Статистика очереди:', JSON.stringify(data.queue, null, 2));
  console.log('⏰ Timestamp:', data.timestamp);

  if (!data || !data.queue) {
    throw new Error('Статистика очереди не получена');
  }

  console.log('✅ Тест 1 пройден: Статистика очереди работает');
  return data.queue;
}

// Тест 2: Отправка запроса к WB API (GET)
async function testEnqueueRequest() {
  console.log('\n=== ТЕСТ 2: Добавление запроса в очередь ===');

  const token = 'eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjUwOTA0djEiLCJ0eXAiOiJKV1QifQ.eyJhY2MiOjEsImVudCI6MSwiZXhwIjoxNzg0MDAyOTM5LCJpZCI6IjAxOWJiMzAzLWY0MjYtNzQ0MC04YzI3LWEyZDg4N2U1NTYzYiIsImlpZCI6MjA0MjM3NjkxLCJvaWQiOjg1MzM4LCJzIjo0MTU4LCJzaWQiOiJkYTVjNzMyOS1lMzU0LTU2ODYtOTViYy1kZGZiZDgxNDM1YmMiLCJ0IjpmYWxzZSwidWlkIjoyMDQyMzc2OTF9.2dVW8EApzzdau9ojtIcdjVhRWpUm4bUniBGFZH4g6Kvsw14aoApGBrycHe1bq4dCPZwVYPNr20R1eDf8jYJ9eA';

  const data = await request(
    '/api/v1/proxy/statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=2026-03-20&flag=0',
    {
      method: 'GET',
      headers: {
        'Authorization': token
      }
    }
  );

  if (!data.data || !data.data.request_id) {
    throw new Error('request_id не получен');
  }

  console.log('🆔 Request ID:', data.data.request_id);
  console.log('📝 Статус:', data.data.status);
  console.log('🏪 Marketplace:', data.data.marketplace);

  if (data.data.status !== 'accepted') {
    throw new Error(`Ожидался статус 'accepted', получен: ${data.data.status}`);
  }

  console.log('✅ Тест 2 пройден: Запрос добавлен в очередь');
  return data.data.request_id;
}

// Тест 3: Проверка статуса запроса по UUID
async function testGetRequestStatus(requestId) {
  console.log('\n=== ТЕСТ 3: Проверка статуса запроса по UUID ===');

  // Ждем обработки запроса
  console.log('⏳ Ожидание обработки запроса...');
  await sleep(3000);

  const data = await request(`/api/v1/queue/${requestId}`);

  if (!data.data) {
    throw new Error('Данные запроса не получены');
  }

  console.log('🆔 UUID:', data.data.uuid);
  console.log('📝 Статус:', data.data.status);
  console.log('🏪 Marketplace:', data.data.marketplace_id);
  console.log('🔗 URL:', data.data.url);
  console.log('📊 Response Status:', data.data.response_status);
  console.log('⏱️  Created:', data.data.created_at);
  console.log('✅ Completed:', data.data.completed_at);

  if (!['accepted', 'processing', 'completed', 'failed'].includes(data.data.status)) {
    throw new Error(`Неизвестный статус: ${data.data.status}`);
  }

  console.log('✅ Тест 3 пройден: Статус запроса получен');
  return data.data;
}

// Тест 4: Проверка списка запросов в очереди
async function testGetQueueList() {
  console.log('\n=== ТЕСТ 4: Проверка списка запросов в очереди ===');

  const data = await request('/api/v1/queue?limit=5');

  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Список запросов не получен');
  }

  console.log('📋 Всего запросов:', data.total);
  console.log('📋 Показано:', data.data.length);

  data.data.forEach((req, index) => {
    console.log(`  ${index + 1}. [${req.status}] ${req.uuid.substring(0, 8)}... - ${req.marketplace_id}`);
  });

  console.log('✅ Тест 4 пройден: Список запросов получен');
  return data;
}

// Тест 5: Проверка списка запросов с фильтром по статусу
async function testGetQueueByStatus() {
  console.log('\n=== ТЕСТ 5: Проверка фильтрации по статусу ===');

  const data = await request('/api/v1/queue?status=completed&limit=3');

  console.log('📋 Завершённых запросов:', data.total);
  console.log('📋 Показано:', data.data.length);

  data.data.forEach((req, index) => {
    console.log(`  ${index + 1}. [${req.status}] ${req.uuid.substring(0, 8)}... - ${req.method} ${req.url.substring(0, 50)}...`);
  });

  // Проверяем что все запросы имеют статус completed
  const allCompleted = data.data.every(req => req.status === 'completed');
  if (!allCompleted) {
    throw new Error('Не все запросы имеют статус completed');
  }

  console.log('✅ Тест 5 пройден: Фильтрация по статусу работает');
  return data;
}

// Тест 6: Отправка запроса с высоким приоритетом
async function testHighPriorityRequest() {
  console.log('\n=== ТЕСТ 6: Запрос с высоким приоритетом ===');

  const token = 'eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjUwOTA0djEiLCJ0eXAiOiJKV1QifQ.eyJhY2MiOjEsImVudCI6MSwiZXhwIjoxNzg0MDAyOTM5LCJpZCI6IjAxOWJiMzAzLWY0MjYtNzQ0MC04YzI3LWEyZDg4N2U1NTYzYiIsImlpZCI6MjA0MjM3NjkxLCJvaWQiOjg1MzM4LCJzIjo0MTU4LCJzaWQiOiJkYTVjNzMyOS1lMzU0LTU2ODYtOTViYy1kZGZiZDgxNDM1YmMiLCJ0IjpmYWxzZSwidWlkIjoyMDQyMzc2OTF9.2dVW8EApzzdau9ojtIcdjVhRWpUm4bUniBGFZH4g6Kvsw14aoApGBrycHe1bq4dCPZwVYPNr20R1eDf8jYJ9eA';

  // Кодируем опции в Base64
  const options = {
    priority: 'high',
    logging: 'verbose'
  };
  const optionsBase64 = Buffer.from(JSON.stringify(options)).toString('base64');

  const data = await request(
    '/api/v1/proxy/statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=2026-03-25&flag=0',
    {
      method: 'GET',
      headers: {
        'Authorization': token,
        'X-Proxy-Options': optionsBase64
      }
    }
  );

  console.log('🆔 Request ID:', data.data.request_id);
  console.log('📝 Статус:', data.data.status);

  console.log('✅ Тест 6 пройден: Запрос с высоким приоритетом отправлен');
  return data.data.request_id;
}

// Тест 7: Проверка обработки несуществующего маркетплейса
async function testInvalidMarketplace() {
  console.log('\n=== ТЕСТ 7: Несуществующий маркетплейс ===');

  try {
    await request(
      '/api/v1/proxy/invalid-marketplace/api/test',
      {
        method: 'GET'
      }
    );
    throw new Error('Ожидалась ошибка 404');
  } catch (error) {
    if (error.message.includes('404')) {
      console.log('✅ Ошибка 404 получена корректно');
      console.log('✅ Тест 7 пройден: Несуществующий маркетплейс обработан');
    } else {
      throw error;
    }
  }
}

// Тест 8: Проверка статистики после всех запросов
async function testFinalStats() {
  console.log('\n=== ТЕСТ 8: Финальная статистика очереди ===');

  const data = await request('/api/v1/queue/stats');

  console.log('📊 Финальная статистика:');
  console.log('   Pending:', data.data.queue.pending);
  console.log('   Processing:', data.data.queue.processing);
  console.log('   Completed:', data.data.queue.completed);
  console.log('   Failed:', data.data.queue.failed);
  console.log('   Retrying:', data.data.queue.retrying);
  console.log('   Dead Letter:', data.data.queue.dead_letter);

  console.log('✅ Тест 8 пройден: Финальная статистика получена');
  return data.data.queue;
}

// Вспомогательная функция
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Основная функция тестирования
async function runTests() {
  console.log('🚀 Запуск тестов очереди запросов');
  console.log('📍 Base URL:', BASE_URL);

  const results = {
    passed: 0,
    failed: 0,
    errors: []
  };

  try {
    /*
    // Тест 1: Статистика
    await testQueueStats();
    results.passed++;

    // Тест 2: Добавление запроса
    const requestId = await testEnqueueRequest();
    results.passed++;
*/
    const requestId = "d87c29af-ce3a-4e91-9c94-e0c25cba4b45";
    // Тест 3: Проверка статуса
    await testGetRequestStatus(requestId);
    results.passed++;

    // Тест 4: Список запросов
    await testGetQueueList();
    results.passed++;

    // Тест 5: Фильтрация по статусу
    await testGetQueueByStatus();
    results.passed++;

    // Тест 6: Высокий приоритет
    await testHighPriorityRequest();
    results.passed++;

    // Тест 7: Несуществующий маркетплейс
    await testInvalidMarketplace();
    results.passed++;

    // Тест 8: Финальная статистика
    await testFinalStats();
    results.passed++;

    console.log('\n' + '='.repeat(50));
    console.log('✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ');
    console.log(`📊 Итого: ${results.passed} прошло, ${results.failed} провалено`);
    console.log('='.repeat(50));

  } catch (error) {
    results.failed++;
    results.errors.push(error.message);

    console.log('\n' + '='.repeat(50));
    console.log('❌ ТЕСТЫ ЗАВЕРШЕНЫ С ОШИБКОЙ');
    console.log(`📊 Итого: ${results.passed} прошло, ${results.failed} провалено`);
    console.log('🔴 Ошибки:', results.errors.join(', '));
    console.log('='.repeat(50));

    process.exit(1);
  }
}

// Запуск
runTests();
