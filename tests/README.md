# 🧪 MP Proxy Service - Test Suite

Комплексная система тестирования MP Proxy Service.

---

## 📁 Файлы тестов

| Файл | Описание | Команда |
|------|----------|---------|
| `test-runner.js` | Integration & Load тесты | `npm test` |
| `test-user-lifecycle.js` | Жизненный цикл пользователя | `npm run test:user` |
| `TEST_RESULTS.md` | Отчёт integration тестов | - |
| `USER_LIFECYCLE_RESULTS.md` | Отчёт user lifecycle тестов | - |

---

## 🚀 Быстрый старт

### Установка зависимостей

```bash
cd tests
npm install
```

### Запуск тестов

```bash
# Все integration тесты
npm test

# User lifecycle тесты
npm run test:user

# Быстрые тесты (без load)
npm run test:quick

# Rate limiting тесты
npm run test:rate-limit

# Load тесты
npm run test:load
```

---

## 📋 Test Suites

### 1. Integration Tests (`test-runner.js`)

**Coverage:** 25 тестов

#### Mock API Tests (7 тестов)
- Health check
- Scenarios endpoint
- Wildberries endpoints (orders, products, stocks, returns)
- Error scenarios (429, 500, 503)

#### Proxy Tests (5 тестов)
- Health endpoint
- Queue stats
- Mocktest integration
- Queue management

#### Rate Limiting Tests (5 тестов)
- Basic rate limiting
- Concurrent requests
- Admin API (limits, stats, usage)

#### Circuit Breaker Tests (3 тестов)
- Admin API (list, stats)
- Error handling

#### Pagination Tests (1 тест)
- Basic pagination flow

#### Load Tests (2 теста)
- Multiple clients
- Recovery after rate limit

**Результат:** 84% (21/25 passed)

---

### 2. User Lifecycle Tests (`test-user-lifecycle.js`)

**Coverage:** 13 тестов

#### Flow:
1. **Create User** - создание через admin API
2. **Authenticate** - login/password, получение JWT
3. **Test Access** - proxy, queue, rate limits
4. **Rate Limiting** - проверка лимитов
5. **Pagination** - создание группы
6. **Delete User** - удаление и верификация

**Результат:** 84.6% (11/13 passed)

---

## 📊 Test Results

### Integration Tests
| Metric | Value |
|--------|-------|
| Total | 25 |
| Passed | 21 |
| Failed | 4 |
| Success | 84% |

### User Lifecycle Tests
| Metric | Value |
|--------|-------|
| Total | 13 |
| Passed | 11 |
| Failed | 2 |
| Success | 84.6% |

---

## 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_URL` | http://localhost:3000 | Proxy API URL |
| `MOCK_URL` | http://localhost:3002 | Mock API URL |

---

## 📝 Test User

User lifecycle тесты создают временного пользователя:

```json
{
  "email": "test_{timestamp}@test.com",
  "password": "TestPassword123!",
  "role": "client",
  "rate_tier": "basic"
}
```

Пользователь автоматически удаляется после тестов.

---

## 🐛 Troubleshooting

### Proxy API not available
```bash
npm start
```

### Mock API not available
```bash
npm run mock:start
```

### Port already in use
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Use different port
MOCK_PORT=3003 npm run mock:start
```

---

## 📈 Coverage

| Component | Integration | Lifecycle |
|-----------|-------------|-----------|
| Mock API | ✅ 100% | - |
| Auth | - | ✅ 100% |
| Proxy | ⚠️ 67% | ✅ 100% |
| Queue | ✅ 100% | ✅ 100% |
| Rate Limiting | ✅ 100% | ✅ 100% |
| Circuit Breaker | ✅ 100% | - |
| Pagination | ⚠️ 50% | ✅ 100% |
| Admin API | ✅ 100% | ✅ 100% |

---

## 🎯 Next Steps

### P0 - Fix Failed Tests
- [ ] Update /auth/me response parsing
- [ ] Fix proxy access test logic

### P1 - Add Tests
- [ ] Token refresh flow
- [ ] Different rate tiers (premium, enterprise)
- [ ] Admin role permissions
- [ ] Concurrent users

### P2 - Improvements
- [ ] Add Prometheus metrics tests
- [ ] Add DLQ (Dead Letter Queue) tests
- [ ] Add Circuit Breaker state tests

---

*Last updated: 2026-03-29*
