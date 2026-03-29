# 📊 Статус разработки MP Proxy Service

**Последнее обновление:** 29 марта 2026 г.

---

## ✅ Реализованный функционал

### 🔐 Аутентификация и авторизация
- ✅ JWT аутентификация (HS256)
- ✅ Access/Refresh токены
- ✅ RBAC (client/admin роли)
- ✅ Тарифы (basic/premium/enterprise)
- ✅ Отзыв токенов

**Endpoints:**
- `POST /auth/login` — получение токена
- `POST /auth/logout` — отзыв токена
- `GET /auth/me` — информация о пользователе

---

### 🚦 Rate Limiting (Иерархический)
- ✅ 6 уровней проверки лимитов
- ✅ In-Memory + SQLite хранение
- ✅ Кэширование конфигураций (TTL 5 мин)
- ✅ Алерты при частых превышениях (>10/час)

**Уровни:**
1. Global IP (1000 запросов/мин)
2. Client (по тарифу)
3. Marketplace (суммарно по МП)
4. Store (лимит на магазин)
5. Token (лимит токена МП)
6. Endpoint (лимит на эндпоинт)

**Admin API:**
- `GET /api/v1/admin/rate-limits` — все лимиты
- `GET /api/v1/admin/rate-limits/:clientId` — лимиты клиента
- `POST /api/v1/admin/rate-limits/override` — переопределение
- `POST /api/v1/admin/rate-limits/reset` — сброс счётчика
- `GET /api/v1/admin/rate-limits/violations` — лог превышений

**Заголовки в ответе:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1774754100
Retry-After: 45 (при 429)
```

---

### 🔄 Circuit Breaker
- ✅ 3 состояния (CLOSED/OPEN/HALF-OPEN)
- ✅ Настраиваемые пороги
- ✅ Автоматическое восстановление
- ✅ Мониторинг и алерты

**Конфигурация (по умолчанию):**
| Параметр | Значение |
|----------|----------|
| failureThreshold | 5 ошибок |
| failureWindowSec | 60 секунд |
| openTimeoutSec | 30 секунд |
| successThreshold | 2 успеха |

**Admin API:**
- `GET /api/v1/admin/circuit-breakers` — все CB
- `GET /api/v1/admin/circuit-breakers/:id` — статус
- `POST /api/v1/admin/circuit-breakers/:id/reset` — сброс
- `PUT /api/v1/admin/circuit-breakers/:id/config` — конфиг
- `GET /api/v1/admin/circuit-breakers/stats` — статистика

---

### 📦 Пагинация запросов
- ✅ Автоматическая загрузка всех страниц
- ✅ Группировка запросов (request_groups)
- ✅ Агрегация результатов
- ✅ msapimp-options для управления

**msapimp-options (Base64 JSON):**
```json
{
  "paginate": true,
  "limit": 100,
  "priority": "high"
}
```

**Примеры Base64:**
- `{"paginate":true}` = `eyJwYWdpbmF0ZSI6dHJ1ZX0=`
- `{"paginate":false}` = `eyJwYWdpbmF0ZSI6ZmFsc2V9`

**Endpoints:**
- `GET /api/v1/proxy/:mp/*?paginate=all` — запуск пагинации
- `GET /api/v1/pagination/groups/:id` — статус группы
- `GET /api/v1/pagination/groups/:id/results` — результаты
- `GET /api/v1/pagination/groups/:id/requests` — список запросов

**Ответ:**
```json
{
  "success": true,
  "request_group_id": "grp_abc123",
  "status": "completed",
  "total_pages": 5,
  "data": [
    { "page": 1, "data": {...} },
    { "page": 2, "data": {...} }
  ]
}
```

---

### 🗄️ База данных (SQLite)

**Таблицы:**
- `clients` — клиенты с тарифами
- `access_tokens` — JWT токены
- `requests` — очередь запросов
- `stores` — магазины клиентов
- `mp_tokens` — токены маркетплейсов
- `rate_limit_configs` — конфигурация лимитов
- `rate_limit_counters` — счётчики лимитов
- `circuit_breaker_configs` — конфиги CB
- `circuit_breaker_stats` — статистика CB
- `request_groups` — группы пагинации
- `logs` — логи системы
- `auth_logs` — логи аутентификации
- `audit_logs` — аудит действий

---

### 📝 Логирование
- ✅ Structured logging (pino)
- ✅ Запись в SQLite
- ✅ Уровни (debug/info/warn/error)
- ✅ request_id в каждом логе

**Endpoints:**
- `GET /api/v1/logs` — просмотр логов
- `DELETE /api/v1/logs?before=...` — очистка

---

### 🏥 Health & Monitoring
- ✅ Health check (Liveness/Readiness)
- ✅ Swagger документация
- ✅ Статистика очереди

**Endpoints:**
- `GET /api/v1/health` — health check
- `GET /api/v1/queue/stats` — статистика очереди
- `GET /docs` — Swagger UI

---

## ⏳ В процессе разработки

### Этап 4: Продакшен
- ✅ Swagger документация
- ✅ Админ-эндпоинты (Rate Limits, Circuit Breakers)
- ⏳ Mock MP API (не реализован)
- ⏳ Integration и E2E тесты
- ⏳ Метрики Prometheus
- ⏳ Уведомления (Slack/Webhook)
- ⏳ CI/CD pipeline

---

## 📋 План работ

### Приоритет P0 (Критично)
- [ ] Тесты (Unit, Integration, E2E)
- [ ] Mock MP API для тестирования
- [ ] Документация API (Swagger)

### Приоритет P1 (Важно)
- [ ] Метрики Prometheus
- [ ] Алерты (Slack, Email, Telegram)
- [ ] CI/CD pipeline (GitHub Actions)

### Приоритет P2 (Желательно)
- [ ] Оптимизация производительности
- [ ] Redis для кэширования
- [ ] Stream-proxy для больших файлов

---

## 📡 Реализованные Endpoints

### Authentication
| Метод | Endpoint | Auth |
|-------|----------|------|
| POST | `/auth/login` | ❌ |
| POST | `/auth/logout` | ❌ |
| GET | `/auth/me` | ✅ |

### Proxy
| Метод | Endpoint | Auth |
|-------|----------|------|
| ALL | `/api/v1/proxy/{marketplace}/*` | ✅ |

### Queue
| Метод | Endpoint | Auth |
|-------|----------|------|
| GET | `/api/v1/queue/stats` | ✅ |
| GET | `/api/v1/queue` | ✅ |
| GET | `/api/v1/queue/:uuid` | ✅ |
| DELETE | `/api/v1/queue/:uuid` | ✅ |
| POST | `/api/v1/queue/clear` | ✅ (admin) |

### Pagination
| Метод | Endpoint | Auth |
|-------|----------|------|
| GET | `/api/v1/pagination/groups/:id` | ✅ |
| GET | `/api/v1/pagination/groups/:id/results` | ✅ |
| GET | `/api/v1/pagination/groups/:id/requests` | ✅ |

### Admin - Rate Limits
| Метод | Endpoint | Auth |
|-------|----------|------|
| GET | `/api/v1/admin/rate-limits` | ✅ (admin) |
| GET | `/api/v1/admin/rate-limits/:clientId` | ✅ (admin) |
| GET | `/api/v1/admin/rate-limits/usage` | ✅ (admin) |
| GET | `/api/v1/admin/rate-limits/violations` | ✅ (admin) |
| GET | `/api/v1/admin/rate-limits/stats` | ✅ (admin) |
| POST | `/api/v1/admin/rate-limits/override` | ✅ (admin) |
| POST | `/api/v1/admin/rate-limits/reset` | ✅ (admin) |

### Admin - Circuit Breakers
| Метод | Endpoint | Auth |
|-------|----------|------|
| GET | `/api/v1/admin/circuit-breakers` | ✅ (admin) |
| GET | `/api/v1/admin/circuit-breakers/:id` | ✅ (admin) |
| GET | `/api/v1/admin/circuit-breakers/stats` | ✅ (admin) |
| POST | `/api/v1/admin/circuit-breakers/:id/reset` | ✅ (admin) |
| PUT | `/api/v1/admin/circuit-breakers/:id/config` | ✅ (admin) |

### Logs
| Метод | Endpoint | Auth |
|-------|----------|------|
| GET | `/api/v1/logs` | ✅ (admin) |
| DELETE | `/api/v1/logs?before=...` | ✅ (admin) |

### Health & Docs
| Endpoint | Описание |
|----------|----------|
| GET `/api/v1/health` | Health check |
| GET `/docs` | Swagger UI |
| GET `/admin` | Admin Panel |

---

## 🔧 Конфигурация

### Переменные окружения
| Переменная | Описание | Пример |
|------------|----------|--------|
| `PORT` | Порт сервиса | 3000 |
| `NODE_ENV` | Среда | development |
| `DB_PATH` | Путь к БД | ./data/proxy.db |
| `JWT_SECRET` | Секрет JWT | your-secret-key |
| `ADMIN_EMAIL` | Email админа | admin@example.com |
| `ADMIN_PASSWORD` | Пароль админа | admin123 |

---

## 🎭 Mock MP API

Mock API для тестирования MP Proxy Service.

### Быстрый старт

```bash
# Из корневого каталога проекта

# Первый запуск (установка зависимостей)
npm run mock:install

# Запуск Mock API (порт 3001)
npm run mock:start

# Запуск в режиме разработки (auto-reload)
npm run mock:dev
```

### Интеграция с MP Proxy

Обновите `config/marketplaces.json`:

```json
{
  "marketplaces": [
    {
      "id": "statistics-api.wildberries.ru",
      "name": "Wildberries (Mock)",
      "baseUrl": "http://localhost:3002/api/v1"
    }
  ]
}
```

### Примеры запросов

```bash
# Health check
curl http://localhost:3002/health

# Wildberries orders
curl "http://localhost:3002/api/v1/supplier/orders?limit=10"

# С ошибкой 429
curl -H "X-Mock-Scenario: error_429" \
  http://localhost:3002/api/v1/supplier/orders
```

### Использование через MP Proxy

**Способ 1: Через mocktest marketplace**

```bash
# Запрос через proxy к mocktest
curl -H "Authorization: Bearer <token>" \
  -H "msapimp-options: eyJwYWdpbmF0ZSI6dHJ1ZX0=" \
  "http://localhost:3000/api/v1/proxy/mocktest/api/v1/supplier/orders"
```

**Способ 2: Прямое подключение к Mock API**

Обновите `config/marketplaces.json`:

```json
{
  "marketplaces": [
    {
      "id": "statistics-api.wildberries.ru",
      "name": "WB_API_STATISTICS (Mock)",
      "baseUrl": "http://localhost:3002/api/v1"
    }
  ]
}
```

📄 **Полная документация:** [mock-api/README.md](mock-api/README.md)

### msapimp-options примеры
```bash
# Пагинация включена (по умолчанию)
echo -n '{"paginate":true}' | base64
# eyJwYWdpbmF0ZSI6dHJ1ZX0=

# Пагинация выключена
echo -n '{"paginate":false}' | base64
# eyJwYWdpbmF0ZSI6ZmFsc2V9

# Кастомный лимит
echo -n '{"paginate":true,"limit":500}' | base64
# eyJwYWdpbmF0ZSI6dHJ1ZSwibGltaXQiOjUwMH0=
```

---

## 📈 Метрики и мониторинг

### Текущие метрики
- Количество запросов в очереди
- Статус Circuit Breaker по МП
- Превышения rate limits
- Активные группы пагинации

### Запланированные метрики (Prometheus)
- `proxy_requests_total` — всего запросов
- `proxy_request_duration_seconds` — время обработки
- `proxy_queue_size` — размер очереди
- `proxy_circuit_breaker_state` — состояние CB
- `proxy_rate_limit_hits` — превышения лимитов

---

## 🧪 Тестирование

### Текущее состояние
- ⏳ Unit тесты не написаны
- ⏳ Integration тесты не написаны
- ⏳ E2E тесты не написаны
- ⏳ Mock MP API не реализован

### План тестирования
1. Unit тесты (Jest) — сервисы, утилиты
2. Integration тесты (Supertest) — endpoints
3. E2E тесты (Docker + Jest) — полные сценарии
4. Load тесты (k6) — производительность

---

## 📝 Changelog

### Версия 0.3.0 (29 марта 2026)
- ✅ Добавлена пагинация запросов
- ✅ msapimp-options вместо X-Proxy-Options
- ✅ request_groups таблица
- ✅ pagination.service.ts
- ✅ Endpoints для получения результатов пагинации

### Версия 0.2.0 (28 марта 2026)
- ✅ Rate Limiting (6 уровней)
- ✅ Circuit Breaker (3 состояния)
- ✅ Admin API для управления лимитами и CB
- ✅ Алерты при превышениях
- ✅ Заголовки X-RateLimit-*

### Версия 0.1.0 (27 марта 2026)
- ✅ Базовая структура проекта
- ✅ JWT аутентификация
- ✅ Proxy controller
- ✅ Queue service (двухуровневая)
- ✅ Health endpoint
- ✅ Swagger документация
