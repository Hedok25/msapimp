/**
 * Скрипт для тестирования MP Proxy Service API
 * Использование: node tests/requests/test-wildberries.js
 */

import axios from 'axios';

const BASE_URL = 'http://localhost:3000';
const ADMIN_EMAIL = 'rachel.goose.gold@gmail.com';
const ADMIN_PASSWORD = '91b2e9162febc';
const MSAPINP_KEY_API = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbi1jbGllbnQiLCJpc3MiOiJtcC1wcm94eS1zZXJ2aWNlIiwiYXVkIjoibXAtcHJveHktc2VydmljZSIsImlhdCI6MTc3NDY4MTY2NSwiZXhwIjoxNzkwMjMzNjY1LCJqdGkiOiI5NzFiM2FmMS04ODVkLTQxYmItYTlhZi0xYzU2OGZhZjQ0OWIiLCJzY29wZSI6WyJwcm94eTpyZWFkIiwicHJveHk6d3JpdGUiXSwicmF0ZV90aWVyIjoiZW50ZXJwcmlzZSIsInJvbGUiOiJhZG1pbiJ9.WY-4Z4RD3TECSYTZFRYS9_cPpwOO9LY1OhqhrjdNNbs"

// Вспомогательная функция для выполнения запросов
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  
  const config = {
    method: options.method || 'GET',
    url,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    data: options.body || undefined
  };

  console.log(`\n📤 ${config.method} ${url}`);
  console.log('🔍 Headers:', JSON.stringify(config.headers, null, 2));
  console.log('🔍 Body:', options.body ? JSON.stringify(options.body).substring(0, 100) : 'none');

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

// 2. Проверка текущей сессии
async function checkMe(accessToken) {
  console.log('\n=== ПРОВЕРКА ТЕКУЩЕЙ СЕССИИ ===');

  const data = await request('/auth/me', {
    headers: {
      'msapimp-key-api': `Bearer ${accessToken}`
    }
  });

  console.log('👤 Client ID:', data.client_id);
  console.log('🎭 Роль:', data.role);
  console.log('📊 Rate tier:', data.rate_tier);
  console.log('✅ Активен:', data.is_active);

  return data;
}

// 3. Запросы к Wildberries Statistics API
async function getWbStatistics(accessToken, endpoint, params = {}) {
  console.log(`\n=== WB API: ${endpoint} ===`);

  const queryString = new URLSearchParams(params).toString();
  const url = `/api/v1/proxy/statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=2026-03-20&flag=0`;
  const token='eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjUwOTA0djEiLCJ0eXAiOiJKV1QifQ.eyJhY2MiOjEsImVudCI6MSwiZXhwIjoxNzg0MDAyOTM5LCJpZCI6IjAxOWJiMzAzLWY0MjYtNzQ0MC04YzI3LWEyZDg4N2U1NTYzYiIsImlpZCI6MjA0MjM3NjkxLCJvaWQiOjg1MzM4LCJzIjo0MTU4LCJzaWQiOiJkYTVjNzMyOS1lMzU0LTU2ODYtOTViYy1kZGZiZDgxNDM1YmMiLCJ0IjpmYWxzZSwidWlkIjoyMDQyMzc2OTF9.2dVW8EApzzdau9ojtIcdjVhRWpUm4bUniBGFZH4g6Kvsw14aoApGBrycHe1bq4dCPZwVYPNr20R1eDf8jYJ9eA'
  try {
    const data = await request(url, {
      headers: {
        'Authorization': token,
        'msapimp-key-api': MSAPINP_KEY_API
      }
    });

    return data;
  } catch (error) {
    console.error(`⚠️ Запрос к ${endpoint} не удался:`, error.message);
    return null;
  }
}

// 4. Выход из системы
async function logout(accessToken) {
  console.log('\n=== ВЫХОД ИЗ СИСТЕМЫ ===');

  await request('/auth/logout', {
    method: 'POST',
    headers: {
      'msapimp-key-api': `Bearer ${accessToken}`
    },
    body: {
      access_token: accessToken
    }
  });

  console.log('👋 Выход выполнен успешно');
}

// Основная функция тестирования
async function runTests() {
  console.log('🚀 Запуск тестирования MP Proxy Service API');
  console.log('📍 Base URL:', BASE_URL);

  try {
    const accessToken = MSAPINP_KEY_API;
    if (!accessToken) {
      throw new Error('Не удалось получить access token');
    }

    // 2. Проверка сессии
    await checkMe(accessToken);

    // 3. Запросы к WB API
    const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    await getWbStatistics(accessToken, 'orders', { dateFrom });

    // 4. Логout
    //await logout(accessToken);

    console.log('\n✅ Все тесты завершены успешно!');

  } catch (error) {
    console.error('\n❌ Тестирование завершено с ошибкой:', error.message);
    process.exit(1);
  }
}

// Запуск
runTests();
