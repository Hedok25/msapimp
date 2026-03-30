## Настройка
Использовать токен для авторизации в микросервисе msapimp
const MSAPINP_KEY_API = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbi1jbGllbnQiLCJpc3MiOiJtcC1wcm94eS1zZXJ2aWNlIiwiYXVkIjoibXAtcHJveHktc2VydmljZSIsImlhdCI6MTc3NDY4MTY2NSwiZXhwIjoxNzkwMjMzNjY1LCJqdGkiOiI5NzFiM2FmMS04ODVkLTQxYmItYTlhZi0xYzU2OGZhZjQ0OWIiLCJzY29wZSI6WyJwcm94eTpyZWFkIiwicHJveHk6d3JpdGUiXSwicmF0ZV90aWVyIjoiZW50ZXJwcmlzZSIsInJvbGUiOiJhZG1pbiJ9.WY-4Z4RD3TECSYTZFRYS9_cPpwOO9LY1OhqhrjdNNbs"

## 🎯 Цель проекта

Разработать серверное приложение на **Node.js (TypeScript)** с использованием **SQLite + In-Memory**, выполняющее функцию **прозрачного прокси-сервиса** для маршрутизации запросов к внешним API маркетплейсов (5-10 МП). Сервис должен обеспечивать безопасность, отказоустойчивость, контроль частоты запросов и возможность масштабирования.

Использовать  better‑sqlite3, AdminJS,axois
Зафиксировать Fastify + @fastify/swagger, @fastify/rate-limit, @fastify/helmet.

---
## 🏗️ 1. Архитектура и модульность

### Структура проекта:
```
/mp-proxy-service
├── /src
│   ├── /admin              # AdminJS: конфигурация, ресурсы, действия
│   ├── /adapters           # Адаптеры МП (Ozon, WB, Yandex...)
│   ├── /config             # Конфигурация: .env, marketplaces.json
│   ├── /middleware         # Auth, rate-limit, валидация, ошибки
│   ├── /routes             # Определение endpoint'ов
│   ├── /controllers        # Обработка HTTP-запросов
│   ├── /services           # Бизнес-логика: очередь, retry, CB, DLQ
│   ├── /db                 # SQLite: инициализация, схемы, миграции
│   ├── /logging            # Логгер (pino) + запись в БД
│   ├── /cleanup            # TTL-очистка (фоновая задача)
│   ├── /validation         # Zod-схемы для входных/выходных данных
│   ├── /health             # Health-check, metrics
│   ├── /utils              # Вспомогательные функции
│   └── /types              # TypeScript типы
├── /mock-api               # Отдельный сервис-заглушка МП
├── /tests                  # Unit, integration, e2e тесты
├── /docker                 # Dockerfile, docker-compose.yml
├── /docs                   # Swagger, API-документация
└── server.ts               # Точка входа
```

### Принципы:
- **Адаптер-паттерн** для каждого маркетплейса
- **Конфигурация эндпоинтов** на уровне МП (URL, лимиты, пагинация)
- **Разделение ответственности**: каждый компонент в отдельном файле
- **Hot reload** конфигурации через watcher (SIGHUP)

---

## 🔐 2. Аутентификация (JWT)

### Тип токена:
- **Access Token**: JWT, хранится в SQLite (хеши), TTL 180 дней

### Алгоритм подписи:
- **Dev**: HS256 (упрощение разработки)
- **Prod**: RS256 (асимметричный, безопаснее)

### JWT Claims:
| Claim | Тип | Обязательный | Описание |
|-------|-----|--------------|----------|
| `sub` | string | ✅ | client_id |
| `iss` | string | ✅ | Издатель токена |
| `aud` | string | ✅ | Аудитория (mp-proxy-service) |
| `iat` | number | ✅ | Время выпуска |
| `exp` | number | ✅ | Время истечения |
| `jti` | string | ✅ | Уникальный ID токена |
| `scope` | string[] | ✅ | Права доступа (отдельно для каждого endpoint) |
| `rate_tier` | string | ✅ | Тариф: basic/premium/enterprise |
| `role` | string | ✅ | client/admin |

### Endpoints:
- `POST /auth/login` — получение access токена
- `POST /auth/logout` — отзыв access токена
- `GET /auth/me` — информация о клиенте

### Хранение:
- Access tokens: SQLite (таблица `access_tokens`, хеши токенов)
- Отзыв токенов: через таблицу `access_tokens` (флаг `is_revoked`)
- Auth logs: SQLite (таблица `auth_logs`, аудит событий)

### RBAC:
- **client**: доступ к прокси, своим запросам, DLQ
- **admin**: доступ ко всем запросам, управление лимитами, CB, логами

---

## 🛣️ 3. Маршрутизация (Path-based Routing)

### Формат запроса клиента:
```
MP URL:     https://api-seller.ozon.ru/v3/posting/fbs/list
Proxy URL:  https://proxy-service.com/api-seller.ozon.ru/posting/fbs/list
```

### Механика:
1. Первый сегмент пути извлекает `marketplace_id` (`/ozon/...`)
2. Остальной путь передаётся в МП без изменений
3. Заголовки и тело форвардятся 1:1
4. Ответ возвращается с опциональной обёрткой

### Реестр маркетплейсов:
- Хранится в `config/marketplaces.json`
- Поддержка hot reload через watcher (SIGHUP)
- Поля: `id`, `name`, `baseUrls`, `endpoints`, `defaults`

### Конфигурация эндпоинтов (на каждый МП):
- URL (базовый + override на эндпоинт)
- Rate limits (requests, window, burst, concurrent)
- Пагинация (type, params, pageSize)
- Ошибки (retryable codes, ignore codes)
- Схемы валидации (Zod)

### Версионирование API:
- Версия в пути (`/ozon/v3/...`, `/ozon/v2/...`)
- Поддержка нескольких версий одновременно через адаптеры

---

## 📦 4. Управление опциями прокси (msapimp-options)

### Заголовок:
- **Имя**: `msapimp-options`
- **Формат**: JSON-объект, закодированный в **Base64**
- **Лимит**: 1 КБ (декодированный размер)

### Схема JSON:
```json
{
  "paginate": "boolean (по умолчанию true)",
  "limit": "number (лимит на страницу, по умолчанию 100)",
  "check_struct": "boolean",
  "logging": "string (minimal|verbose|debug)",
  "priority": "string (low|normal|high|critical)",
  "webhook_url": "string (url)",
  "timeout_override": "number (max 60000)",
  "response_format": "string (wrapped|raw)",
  "idempotency_key": "string (uuid)",
  "cache_ttl": "number (seconds, 0 = disabled)",
  "retry_disabled": "boolean",
  "skip_validation": "boolean"
}
```

### Пример использования:

#### 1. Запрос с пагинацией (по умолчанию)
```bash
# Кодируем JSON в Base64
echo -n '{"paginate":true,"limit":100}' | base64
# Результат: eyJwYWdpbmF0ZSI6dHJ1ZSwibGltaXQiOjEwMH0=

# Отправляем запрос
curl -H "Authorization: Bearer <token>" \
  -H "msapimp-options: eyJwYWdpbmF0ZSI6dHJ1ZSwibGltaXQiOjEwMH0=" \
  http://localhost:3000/api/v1/proxy/ozon/products
```

#### 2. Запрос без пагинации (одна страница)
```bash
# Кодируем JSON в Base64
echo -n '{"paginate":false}' | base64
# Результат: eyJwYWdpbmF0ZSI6ZmFsc2V9

curl -H "Authorization: Bearer <token>" \
  -H "msapimp-options: eyJwYWdpbmF0ZSI6ZmFsc2V9" \
  http://localhost:3000/api/v1/proxy/ozon/products
```

#### 3. Запрос с кастомным лимитом
```bash
echo -n '{"paginate":true,"limit":500,"priority":"high"}' | base64

curl -H "Authorization: Bearer <token>" \
  -H "msapimp-options: <base64>" \
  http://localhost:3000/api/v1/proxy/ozon/products
```

### Приоритет настроек:
1. **Заголовок msapimp-options** (override)
2. **JWT Claims** `proxy_options`
3. **Конфиг в БД** (client_id, по умолчанию)

### Обработка ошибок:
- Ошибка декодирования → `400 Bad Request`
- Превышен лимит размера → `413 Payload Too Large`
- Неизвестные поля → игнорируются (warning в лог)

---

## 🚦 5. Rate Limiting (Иерархический)

### Уровни Rate Limiting (обновлённые):
💡 Рекомендация: Реализовать кэширование связей client_id → stores → tokens в In-Memory (с TTL 5 мин), чтобы не делать запросы в БД на каждый запрос. Это критично для производительности.
у каждого МП по свойму определяется store_id: например на озон - в заголовке прописан, на вб - в токене авторизации расшифровать надо

| Уровень | Ключ | Описание |
|---------|------|----------|
| Global IP | `ip` | Защита от DoS (1000 запросов/мин) |
| Client | `client_id` | По тарифу (basic/premium/enterprise) |
| Marketplace | `client_id:marketplace` | Суммарно по всем магазинам на МП |
| Store | `client_id:store_id` | 🔹 Лимит на магазин (клиент может иметь несколько) |
| Token | `client_id:mp_token_id` | 🔹 Лимит на токен МП (несколько токенов на магазин) |
| Endpoint | `client_id:store_id:endpoint` | Тонкая настройка на эндпоинт |
┌─────────────────────────────────────────────────────────────┐
│                    Запрос получен                           │
│  Headers: Authorization, X-Proxy-Options                    │
│  Path: /ozon/v3/analytics/data                              │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  1. Global IP Limit (ip:192.168.1.1)                        │
│     → Превышен? → 429 Too Many Requests                     │
└─────────────────────┬───────────────────────────────────────┘
                      │ ✅
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Client Limit (client:client_1)                          │
│     → По тарифу (premium: 100/мин)                          │
│     → Превышен? → 429 + Upgrade suggestion                  │
└─────────────────────┬───────────────────────────────────────┘
                      │ ✅
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Marketplace Limit (mp:client_1:ozon)                    │
│     → Суммарно по всем магазинам на Ozon                    │
│     → Превышен? → 429 + Retry-After                         │
└─────────────────────┬───────────────────────────────────────┘
                      │ ✅
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Store Limit (store:client_1:store_ozon_1)               │
│     → Лимит на конкретный магазин                           │
│     → Превышен? → 429 + Store quota exceeded                │
└─────────────────────┬───────────────────────────────────────┘
                      │ ✅
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Token Limit (token:client_1:token_ozon_a)               │
│     → Лимит самого маркетплейса на токен                    │
│     → Превышен? → 429 от МП (внешний лимит)                 │
└─────────────────────┬───────────────────────────────────────┘
                      │ ✅
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  6. Endpoint Limit (endpoint:client_1:store_ozon_1:/v3/...) │
│     → Тонкая настройка на тяжёлые эндпоинты                 │
│     → Превышен? → 429 + Endpoint quota                      │
└─────────────────────┬───────────────────────────────────────┘
                      │ ✅
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Запрос разрешён                          │
│  → Отправка в очередь → Обработка                           │
└─────────────────────────────────────────────────────────────┘
### Сущности в БД:
- `clients` — клиенты с тарифами
- `stores` — магазины (привязаны к клиенту + МП)
- `mp_tokens` — токены МП (привязаны к магазину)
- `rate_limits` — счётчики лимитов (все уровни)
- `client_mp_limits` — конфигурация лимитов на клиента

### JWT Claims:
- `sub` — client_id
- `rate_tier` — тариф
- `stores` — массив магазинов (или загрузка из БД)

### Приоритет проверки:
1. Global IP → 2. Client → 3. Marketplace → 4. Store → 5. Token → 6. Endpoint

### Тарифы (из JWT):
| Tier | Requests/Min | Concurrent | Burst |
|------|--------------|------------|-------|
| basic | 30 | 2 | 5 |
| premium | 100 | 5 | 15 |
| enterprise | 500 | 20 | 50 |

### Хранение:
- **In-Memory**: быстрая проверка, TTL = окно лимита
- **SQLite**: аудит, восстановление после рестарта
- **Синхронизация**: асинхронная запись при каждом запросе

---

## 🛠️ Rate Limiting API

### Admin Endpoints

| Метод | Endpoint | Описание |
|-------|----------|----------|
| `GET` | `/api/v1/admin/rate-limits` | Все лимиты системы |
| `GET` | `/api/v1/admin/rate-limits/:clientId` | Лимиты конкретного клиента |
| `GET` | `/api/v1/admin/rate-limits/usage` | Текущее использование лимитов |
| `GET` | `/api/v1/admin/rate-limits/violations` | Лог превышений (429 ошибки) |
| `GET` | `/api/v1/admin/rate-limits/stats` | Статистика по лимитам |
| `POST` | `/api/v1/admin/rate-limits/override` | Переопределение лимита |
| `POST` | `/api/v1/admin/rate-limits/reset` | Сброс счётчика лимита |

### Примеры запросов

#### Получение всех лимитов
```bash
curl -H "Authorization: Bearer <admin-token>" \
  http://localhost:3000/api/v1/admin/rate-limits
```

#### Переопределение лимита для клиента
```bash
curl -X POST \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"level":"client","key":"client_123","requests":200,"window_sec":60}' \
  http://localhost:3000/api/v1/admin/rate-limits/override
```

#### Сброс счётчика
```bash
curl -X POST \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"key":"client:client_123"}' \
  http://localhost:3000/api/v1/admin/rate-limits/reset
```

---

## 📊 Rate Limiting: Заголовки в ответе

### При успешном запросе (2xx)
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1774754100
X-RateLimit-Level: client
```

### При превышении лимита (429)
```
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1774754100
X-RateLimit-Level: store
Content-Type: application/json

{
  "error": {
    "status": false,
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Store 'Ozon Store 1' rate limit exceeded",
    "detail": {
      "level": "store",
      "store_id": "123"
    },
    "retry_after": 45,
    "limit": 100,
    "remaining": 0,
    "reset_at": "2026-03-29T12:35:00.000Z"
  },
  "services_info": {
    "status": false,
    "created_at": "2026-03-29T12:34:15.000Z",
    "request_id": "uuid-here"
  }
}
```

---

## 🔔 Алерты при превышениях

Система автоматически отслеживает частые превышения лимитов:

- **Порог**: 10 превышений за час
- **Действие**: Запись в лог с уровнем `warn`
- **Хранение**: Таблица `audit_logs` (action: `RATE_LIMIT_VIOLATION`)

### Настройка порогов

В файле `src/services/rate-limit-alert.service.ts`:

```typescript
private readonly ALERT_THRESHOLD = 10;        // Превышений за час
private readonly ALERT_WINDOW_MS = 60 * 60 * 1000; // 1 час
```

### Интеграция с уведомлениями

Для отправки уведомлений (Email, Slack, Telegram) реализуйте метод `sendWebhook` в `RateLimitAlertService`:

```typescript
private async sendWebhook(data: { clientId: string; violationCount: number }) {
  // Отправка webhook
  await fetch('https://your-webhook-url.com/alerts', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}
```
- **Защита от race condition**: `async-mutex` в пределах процесса

### Ключ лимита:
```
rate_limit_key = `${client_id}:${rate_tier}:${marketplace}:${endpoint}:${window}`
```

### Ответ при превышении:
- HTTP `429 Too Many Requests`
- Заголовок `Retry-After: <seconds>`
- Тело: `{ code: "RATE_LIMIT_EXCEEDED", retry_after: N }`

---

## 🔄 6. Очередь запросов (Двухуровневая)

### Уровни:
| Уровень | Хранилище | TTL | Назначение |
|---------|-----------|-----|------------|
| Hot | In-Memory | 30 мин | Быстрая обработка |
| Cold | SQLite | 24 часа | Восстановление, аудит |

### Flow:
1. Запрос → генерация UUID → запись в обе очереди
2. Worker берёт из in-memory → отправляет к МП
3. При успехе → статус `completed`
4. При ошибке → retry или DLQ

### Статусы запроса:
```
accepted → processing → completed
                     ↘ failed → dead_letter
                     ↘ retrying
                     ↘ circuit_open
                     ↘ rate_limited
```

### Worker Pool:
- Пул воркеров для параллельной обработки
- Back-pressure: пауза при переполнении очереди
- Приоритизация: `critical > high > normal > low`

### Endpoints:
- `GET /api/v1/requests/:uuid` — получить результат
- `DELETE /api/v1/requests/:uuid` — удалить из очереди
- `POST /api/v1/queue/clear` — очистка (админ)

### Восстановление после рестарта:
- Загрузка активных запросов из SQLite в in-memory
- Статусы `accepted`/`processing` восстанавливаются
- Статусы `completed`/`failed` остаются в истории

---

## 🛡️ 7. Circuit Breaker (На каждый МП)

### Состояния:
| Состояние | Описание | Поведение |
|-----------|----------|-----------|
| CLOSED | Нормальная работа | Запросы выполняются |
| OPEN | Маркетплейс недоступен | Запросы блокируются (503) |
| HALF-OPEN | Тестовый режим | 1 тестовый запрос |

### Параметры (настраиваются на МП):
| Параметр | Значение по умолчанию |
|----------|----------------------|
| `failure_threshold` | 5 ошибок |
| `failure_window_sec` | 60 секунд |
| `open_timeout_sec` | 30 секунд |
| `half_open_max_requests` | 1 |
| `success_threshold` | 2 успеха |
| `error_codes` | [500, 502, 503, 504] |
| `exclude_codes` | [429, 400, 401, 403] |

### Поведение при OPEN:
- Запросы блокируются немедленно
- Ответ: `503 Service Unavailable` + `Retry-After`
- Не попадает в DLQ (это не ошибка запроса)

### Шардинг:
- По умолчанию: 1 CB на маркетплейс
- При росте нагрузки: отдельный CB на каждый эндпоинт

### Endpoints:
- `GET /api/v1/circuit-breakers` — список состояний
- `GET /api/v1/circuit-breakers/:marketplace` — детали по МП
- `POST /api/v1/circuit-breakers/:marketplace/reset` — сброс (админ)

---

## 📬 8. Dead Letter Queue (DLQ)

### Критерии попадания:
| Сценарий | Условие |
|----------|---------|
| Исчерпаны retry | `attempts >= max_attempts` (5) |
| Превышен TTL | `created_at + 24h < NOW` |
| Критическая ошибка | 4xx (кроме 429): 400, 401, 403, 404 |
| Лимит МП > 5 мин | Rate limit требует ожидания > 300 сек |
| Валидация не пройдена | `check_struct: true` + структура не соответствует |

### Хранение:
| Уровень | Хранилище | TTL |
|---------|-----------|-----|
| Hot | In-Memory | 30 минут |
| Cold | SQLite | 30 дней |
| Лимит | 10000 записей | — |

### Payload:
```json
{
  "request": { "url", "method", "headers", "body" },
  "response": { "status", "headers", "body" },
  "error": { "code", "message", "stack" },
  "metadata": { "client_id", "marketplace", "attempts", "timestamps" }
}
```

### Endpoints:
- `GET /api/v1/dlq` — список запросов (фильтрация)
- `GET /api/v1/dlq/:uuid` — детали запроса
- `POST /api/v1/dlq/:uuid/retry` — повторная отправка
- `POST /api/v1/dlq/retry-batch` — массовый retry
- `DELETE /api/v1/dlq/:uuid` — удаление
- `DELETE /api/v1/dlq` — массовое удаление
- `GET /api/v1/dlq/stats` — статистика

### Уведомления:
- Webhook/Slack/Email при превышении порога
- Порог: >10 запросов в DLQ за 1 час
- Авто-повтор: опционально, с задержкой 1 час

---

## ✅ 9. Валидация данных

### Входные данные:
- Наличие обязательных полей (token, client_id, url)
- Корректность формата URL
- Допустимые типы в `X-Proxy-Options`
- Лимит тела запроса: 5 МБ по умолчанию

### Ответ от МП:
- Проверка структуры через **Zod-схемы** (на МП и эндпоинт)
- Нормализация: числа → number, даты → ISO 8601
- При ошибке структуры → пометка `invalid_structure`

### Режимы:
| Опция | Поведение |
|-------|-----------|
| `check_struct: true` | Проверка + предупреждение клиенту |
| `check_struct: false` | Сохранить «как есть» |
| `skip_validation: true` | Полностью пропустить валидацию |

### Схемы:
- Хранятся в `src/adapters/*/schemas.ts`
- Отдельная схема на каждый эндпоинт МП
- Версионирование схем вместе с адаптером

---

## 📝 10. Логирование

### Хранение:
- SQLite (таблица `logs`)
- Structured logging (JSON-формат)

### Поля лога:
| Поле | Тип | Описание |
|------|-----|----------|
| `timestamp` | DATETIME | Время события |
| `level` | TEXT | info/warn/error/debug |
| `request_id` | TEXT | UUID запроса |
| `client_id` | TEXT | Из JWT |
| `action` | TEXT | Тип действия |
| `error_short` | TEXT | Краткое описание |
| `error_message` | TEXT | Полное сообщение |
| `metadata` | JSON | Доп. данные |

### Уровни:
| Уровень | Когда используется |
|---------|-------------------|
| `info` | Успешные запросы |
| `warn` | Retry, rate limit, circuit breaker |
| `error` | Ошибки, DLQ, auth failures |
| `debug` | Детальная отладка (только dev) |

### Endpoints:
- `GET /api/v1/logs` — просмотр (с фильтрацией по дате, уровню, client_id)
- `DELETE /api/v1/logs?before=...` — очистка старых

### Аудит:
- Отдельная таблица `audit_logs` для действий администратора
- События: login, logout, dlq_retry, circuit_reset, config_reload

---

## 🧹 11. Очистка устаревших данных (TTL Cleanup)

### Фоновый процесс:
- Периодичность: каждые 5 минут
- Max-batch-size: 1000 записей за раз (защита от перегрузки)
- Не блокирует основной поток

### Очистка:
| Таблица | TTL | Условие |
|---------|-----|---------|
| In-Memory (requests) | 30 минут | `created_at + 30min < NOW` |
| SQLite (requests) | 24 часа | `created_at + 24h < NOW` |
| SQLite (logs) | 7 дней | `timestamp + 7d < NOW` |
| SQLite (DLQ) | 30 дней | `moved_to_dlq_at + 30d < NOW` |
| SQLite (jwt_blacklist) | По exp | `expires_at < NOW` |
| SQLite (access_tokens) | 180 дней | `expires_at < NOW` |

### Гарантии:
- Логирование процесса очистки
- Метрики: `cleanup_records_deleted`, `cleanup_duration_ms`
- Алерт при ошибке очистки

---

## 🏥 12. Health-check и мониторинг

### Endpoint: `GET /health`

### Режимы:
| Параметр | Описание |
|----------|----------|
| `/health` | Liveness (жив ли сервис) |
| `/health?ready=true` | Readiness (готов ли принимать запросы) |

### Ответ:
```json
{
  "status": "ok|degraded|unavailable",
  "uptime_sec": 12345,
  "queue": {
    "in_memory": { "pending": 12, "processing": 3 },
    "persistent": { "pending": 45 }
  },
  "database": { "sqlite": "connected" },
  "marketplaces": {
    "ozon": { "status": "available", "circuit_state": "closed" },
    "wb": { "status": "unavailable", "circuit_state": "open" }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Prometheus-метрики:
| Метрика | Тип | Лейблы |
|---------|-----|--------|
| `proxy_requests_total` | Counter | `client_id`, `marketplace`, `endpoint`, `status` |
| `proxy_request_duration_seconds` | Histogram | `marketplace`, `endpoint` |
| `proxy_queue_size` | Gauge | `queue_type` |
| `proxy_dlq_count` | Gauge | `marketplace`, `failure_reason` |
| `proxy_circuit_breaker_state` | Gauge | `marketplace` |
| `proxy_rate_limit_hits` | Counter | `client_id`, `marketplace` |
| `proxy_retry_count` | Counter | `marketplace`, `endpoint` |
| `proxy_cache_hits` | Counter | `marketplace`, `endpoint` |
| `proxy_errors_total` | Counter | `type`, `marketplace` |

### Endpoint: `GET /metrics`
- Формат: Prometheus exposition format
- Обновление: в реальном времени

---

## 🚀 13. Graceful Shutdown

### Обработчики сигналов:
- `SIGTERM` — основное завершение (Kubernetes, systemd)
- `SIGINT` — локальная разработка (Ctrl+C)

### Пошаговый план:
1. Остановить приём новых запросов (503 + Retry-After)
2. Дождаться завершения активных обработок (таймаут 30 сек)
3. Сохранить in-memory очередь в SQLite
4. Закрыть соединения с БД
5. Записать финальный лог
6. Завершить процесс (exit code 0)

### Kubernetes:
| Параметр | Значение |
|----------|----------|
| `livenessProbe` | `/health` |
| `readinessProbe` | `/health?ready=true` |
| `terminationGracePeriodSeconds` | 60 |

---

## 🧪 14. Тестирование

### Mock MP API (отдельный сервис):
- Эмулирует 5-10 МП
- Поддерживает: пагинацию, задержки, ошибки (429, 500)
- Сценарии: `success`, `error-5xx`, `rate-limit`, `cb-failure`
- Конфигурируется через `.env` или JSON
- Запускается отдельно (Docker / npm)

### Типы тестов:
| Тип | Что тестируем | Инструменты | Покрытие |
|-----|---------------|-------------|----------|
| Unit | Валидация, UUID, нормализация | Jest | ≥80% |
| Integration | Полный цикл: запрос → ответ | Supertest | ≥80% |
| E2E | Очередь, retry, DLQ, Circuit Breaker | Docker + Jest | Критические пути 100% |

### Фикстуры:
- `mock-data/responses.json` — успешные ответы
- `mock-data/errors.json` — ошибки
- `mock-data/scenarios.json` — сценарии тестирования

### E2E среда:
- Docker-compose network: `testnet`
- Сервисы: Proxy + Mock-MP + SQLite
- Изоляция от продакшена

### Load Test (k6 после Этапа 2):
| Сценарий | RPS | Длительность | Цель |
|----------|-----|--------------|------|
| Базовая нагрузка | 50 | 5 мин | Стабильность |
| Пиковая нагрузка | 200 | 2 мин | Узкие места |
| Стресс-тест | 500 | 1 мин | Предел системы |
| Выносливость | 100 | 30 мин | Утечки памяти |

### Критерии успеха load-test:
- Error rate < 1%
- P95 latency < 2 сек
- CPU < 80%, Memory < 70%

---

## 📚 15. Документация

### Swagger:
- Генерация из `@fastify/swagger` + OpenAPI annotations
- Полная спецификация всех endpoints
- Примеры запросов/ответов
- Схемы моделей данных

### Клиентская документация:
- Таблица соответствий: `MP URL → Proxy URL`
- Примеры для популярных SDK (Ozon, WB, Yandex)
- Описание заголовка `X-Proxy-Options` (формат Base64)
- FAQ и troubleshooting

### Внутренняя документация:
- Архитектурные решения (ADR)
- Инструкция по добавлению нового МП
- Runbook для инцидентов

Admin Panel:
- URL: /admin
- Доступ: только роль admin
- Функции: просмотр БД, управление DLQ, сброс CB, аудит

---

## 🛠️ 16. Этапы разработки

> 📊 **Актуальный статус:** См. файл [STATUS.md](STATUS.md) для подробной информации.

---

### ✅ Этап 1: Ядро (ВЫПОЛНЕН)

**Реализовано:**
- [x] Базовая структура проекта (TypeScript + ESLint + Prettier)
- [x] SQLite инициализация + базовые таблицы (8 таблиц)
- [x] JWT аутентификация (login, logout, me)
- [x] Path-based routing (универсальный для всех МП)
- [x] Двухуровневая очередь (in-memory + SQLite)
- [x] Health endpoint

**Definition of Done:**
- ✅ JWT auth работает (HS256, 180 дней)
- ✅ Маркетплейсы подключаются через config
- ✅ Health endpoint возвращает 200
- ✅ Очередь восстанавливается после рестарта

---

### ✅ Этап 2: Надёжность (ВЫПОЛНЕН)

**Реализовано:**
- [x] **Rate Limiting** — 6 уровней + алерты при превышениях
  - Global IP → Client → Marketplace → Store → Token → Endpoint
  - In-Memory кэш + SQLite персистентность
  - Заголовки `X-RateLimit-*` в ответе
  - Admin API для управления лимитами
- [x] **Circuit Breaker** — 3 состояния (CLOSED/OPEN/HALF-OPEN)
  - Настраиваемые пороги (failureThreshold, openTimeoutSec)
  - Автоматическое восстановление
  - Admin API для мониторинга и сброса
- [x] **Dead Letter Queue** — автоматическая запись failed запросов
- [x] **Логирование** — pino + запись в SQLite
- [x] **TTL Cleanup** — фоновая очистка каждую минуту

**Definition of Done:**
- ✅ Rate limit блокирует превышения (7 уровней проверки)
- ✅ Circuit Breaker переключает состояния
- ✅ DLQ записывает ошибки (таблица requests)
- ✅ Admin API работает (14 endpoints)

---

### ✅ Этап 3: Масштабирование (ВЫПОЛНЕН)

**Реализовано:**
- [x] **Пагинация запросов** — автоматическая загрузка всех страниц
  - Таблица `request_groups` для группировки
  - Сервис `pagination.service.ts`
  - Endpoints для получения результатов
- [x] **msapimp-options** — Base64-encoded JSON (замена X-Proxy-Options)
  - `paginate: boolean` (по умолчанию true)
  - `limit: number` (лимит на страницу)
  - `priority: string` (low/normal/high/critical)
- [x] **Конфигурация эндпоинтов** — через `config/marketplaces.json`
- [x] **Восстановление очереди** — после рестарта сервера
- [x] **Graceful Shutdown** — обработка SIGTERM/SIGINT

**Definition of Done:**
- ✅ Пагинация работает (GET /api/v1/pagination/groups/:id/results)
- ✅ msapimp-options парсится (Base64 JSON, 1 КБ лимит)
- ✅ Очередь восстанавливается после рестарта
- ✅ Graceful Shutdown отрабатывает

---

### ⏳ Этап 4: Продакшен (В ПРОЦЕССЕ)

**Реализовано:**
- [x] Swagger документация (`@fastify/swagger-ui`, `/docs`)
- [x] Админ-эндпоинты (Rate Limits, Circuit Breakers)
- [x] **Mock MP API** — отдельный сервис для тестирования

**Не реализовано:**
- [ ] Integration и E2E тесты (покрытие ≥80%)
- [ ] Метрики Prometheus + алерты
- [ ] Уведомления (Webhook/Slack) при DLQ и Circuit Breaker
- [ ] CI/CD pipeline (GitHub Actions)

**Definition of Done:**
- ⏳ Mock-MP не реализован
- ⏳ Тесты не написаны
- ✅ Swagger сгенерирован (`/docs`)
- ⏳ Метрики в Prometheus не настроены
- ✅ Админ-эндпоинты работают (14 endpoints)
- ⏳ CI/CD пайплайн не настроен

---

### ⏳ Этап 5: Оптимизация (НЕ НАЧАТ)

**Запланировано:**
- [ ] Профилирование производительности
- [ ] Оптимизация запросов к SQLite
- [ ] LRU кэш для GET-запросов (TTL 5 мин)
- [ ] План перехода на Redis (при >1000 запросов/сек)
- [ ] Security audit (токены, шифрование, доступы)
- [ ] Stream-proxy для больших файлов (до 50 МБ)

---
- [ ] Админ-эндпоинты (управление DLQ, лимитами, CB)
- [ ] CI/CD pipeline (GitHub Actions)

**Definition of Done:**
- ✅ Mock-MP работает
- ✅ Тесты ≥80%
- ✅ Swagger сгенерирован
- ✅ Метрики в Prometheus
- ✅ CI/CD пайплайн зелёный

---

### Этап 5: Оптимизация (непрерывно)
- [ ] Профилирование производительности
- [ ] Оптимизация запросов к SQLite
- [ ] LRU кэш для GET-запросов (TTL 5 мин)
- [ ] План перехода на Redis (при >1000 запросов/сек)
- [ ] Security audit (токены, шифрование, доступы)
- [ ] Stream-proxy для больших файлов (до 50 МБ)


### CI/CD Pipeline (GitHub Actions):
| Stage | Задачи |
|-------|--------|
| lint | ESLint, Prettier check |
| test | Unit + Integration тесты |
| build | Docker build + push |
| deploy | Deploy to server (если main branch) |

### Переменные окружения (.env):
| Переменная | Описание | Пример |
|------------|----------|--------|
| `NODE_ENV` | Среда | development/production |
| `JWT_SECRET` | Секрет для HS256 | dev-secret |
| `JWT_PRIVATE_KEY` | Private key для RS256 | -----BEGIN RSA PRIVATE KEY----- |
| `JWT_PUBLIC_KEY` | Public key для валидации | -----BEGIN PUBLIC KEY----- |
| `DB_PATH` | Путь к SQLite файлу | /app/data/proxy.db |
| `PORT` | Порт сервиса | 3000 |
| `LOG_LEVEL` | Уровень логирования | info/debug |
| `MAX_BODY_SIZE` | Лимит тела запроса (MB) | 5 |

---

## ✅ Финальный чек-лист требований

| Категория | Требование | Статус |
|-----------|------------|--------|
| **Аутентификация** | JWT HS256 (dev) / RS256 (prod) | ✅ |
| **Маршрутизация** | Path-based с виртуальным маппингом | ✅ |
| **Опции** | msapimp-options (Base64 JSON, 1 КБ лимит) | ✅ |
| **Rate Limit** | 6 уровней + алерты, In-Memory + SQLite | ✅ |
| **Очередь** | 2 уровня, worker-pool, back-pressure | ✅ |
| **Circuit Breaker** | 3 состояния, Admin API | ✅ |
| **DLQ** | Автоматическая запись failed запросов | ✅ |
| **Валидация** | Zod-схемы в адаптерах | ✅ |
| **Логирование** | Structured (pino), request_id в каждом логе | ✅ |
| **TTL Cleanup** | Фоновая задача (каждую минуту) | ✅ |
| **Health** | Liveness + Readiness | ✅ |
| **Shutdown** | SIGTERM + SIGINT обработчики | ✅ |
| **Swagger** | @fastify/swagger-ui (/docs) | ✅ |
| **Пагинация** | request_groups, агрегация ответов | ✅ |
| **Admin API** | Rate Limits + Circuit Breakers (14 endpoints) | ✅ |
| **Конфиг** | marketplaces.json + rate_limits.json | ✅ |
| **Таймауты** | 30 сек по умолчанию, override через опции | ✅ |
| **Лимит тела** | 5 МБ по умолчанию | ✅ |
| **RBAC** | 2 роли: client, admin | ✅ |
| **Метрики** | Prometheus (не реализовано) | ⏳ |
| **Тесты** | Unit/Integration/E2E (не реализовано) | ⏳ |
| **CI/CD** | GitHub Actions (не реализовано) | ⏳ |
| **Mock MP** | Отдельный сервис (реализовано) | ✅ |

---

## 📡 Реализованные Endpoints

### Authentication (Аутентификация)

| Метод | Endpoint | Описание | Auth |
|-------|----------|----------|------|
| `POST` | `/auth/login` | Получение access токена | ❌ |
| `POST` | `/auth/logout` | Отзыв access токена | ❌ |
| `GET` | `/auth/me` | Информация о текущем пользователе | ✅ |

---

### Health & Monitoring (Здоровье и мониторинг)

| Метод | Endpoint | Описание | Auth |
|-------|----------|----------|------|
| `GET` | `/health` | Health check (Liveness/Readiness) | ❌ |
| `GET` | `/api/v1/queue/stats` | Статистика очереди запросов | ✅ |
| `GET` | `/api/v1/logs` | Просмотр логов с фильтрацией | ✅ |
| `DELETE` | `/api/v1/logs?before=...` | Очистка логов старше даты | ✅ (admin) |

---

### Proxy (Проксирование)

| Метод | Endpoint | Описание | Auth |
|-------|----------|----------|------|
| `ALL` | `/api/v1/proxy/{marketplace}/*` | Проксирование запросов к API маркетплейса | ✅ |

**Параметры:**
- `marketplace` — ID маркетплейса (ozon, wb, yandex...)
- Заголовок `msapimp-key-api` — API ключ для авторизации в прокси-микросервисе
- Заголовок `msapimp-options` — Base64-encoded JSON с опциями (опционально)

---

### Admin API (Управление)

#### Клиенты

| Метод | Endpoint | Описание |
|-------|----------|----------|
| `POST` | `/admin/api/clients` | Создать нового клиента |
| `DELETE` | `/admin/api/clients/:clientId` | Удалить клиента |
| `PUT` | `/admin/api/clients/:clientId/status` | Изменить статус клиента (is_active) |

#### Access Tokens

| Метод | Endpoint | Описание |
|-------|----------|----------|
| `POST` | `/admin/api/access_tokens/:id/revoke` | Отозвать токен |
| `DELETE` | `/admin/api/access_tokens/:id/delete` | Удалить токен (безвозвратно) |

#### Ресурсы (CRUD для всех таблиц)

| Метод | Endpoint | Описание |
|-------|----------|----------|
| `GET` | `/admin/api/resources` | Список доступных ресурсов |
| `GET` | `/admin/api/:table` | Получить данные из таблицы (пагинация: limit, offset) |
| `GET` | `/admin/api/:table/:id` | Получить запись по ID |
| `PUT` | `/admin/api/:table/:id` | Обновить запись |
| `DELETE` | `/admin/api/:table/:id` | Удалить запись |

#### Дашборд

| Метод | Endpoint | Описание |
|-------|----------|----------|
| `GET` | `/admin/api/dashboard` | Статистика сервера (количество записей в таблицах, uptime, память) |
| `POST` | `/admin/api/logout` | Выход из админки |

---

### Admin UI

| Endpoint | Описание |
|----------|----------|
| `/admin/login` | Страница входа в админку |
| `/admin` | AdminJS панель управления |

---

### Swagger Documentation

| Endpoint | Описание |
|----------|----------|
| `/docs` | Swagger UI с полной спецификацией API |
| `/docs/json` | JSON спецификация OpenAPI |

---

## 🔑 Роли и доступы

| Роль | Доступ |
|------|--------|
| `client` | Прокси, свои запросы, DLQ, queue stats, logs |
| `admin` | Полный доступ ко всем endpoints + Admin UI |

---

## 🎭 Mock MP API

Для тестирования создан отдельный Mock API сервис, который симулирует ответы маркетплейсов.

### Быстрый старт

```bash
# Из корневого каталога проекта

# Первый запуск (установка зависимостей)
npm run mock:install

# Запуск Mock API (порт 3002)
npm run mock:start

# Запуск в режиме разработки (auto-reload)
npm run mock:dev
```

### Устранение ошибок

**Ошибка: Port 3002 is already in use**

```bash
# Windows - найти процесс
netstat -ano | findstr :3002

# Остановить процесс (замените <PID> на номер процесса)
taskkill /PID <PID> /F

# Или использовать другой порт
set MOCK_PORT=3003 && npm run mock:start
```

### Endpoints

**Wildberries:**
- `GET /api/v1/supplier/orders` — Заказы
- `GET /api/v1/supplier/products` — Товары
- `GET /api/v1/supplier/stocks` — Остатки

**Ozon:**
- `POST /v3/posting/fbs/list` — Список заказов
- `POST /v1/product/list` — Товары

### Сценарии тестирования

```bash
# Успешный ответ
curl http://localhost:3002/api/v1/supplier/orders

# Ошибка 429
curl -H "X-Mock-Scenario: error_429" \
  http://localhost:3002/api/v1/supplier/orders

# Таймаут
curl -H "X-Mock-Scenario: timeout" \
  http://localhost:3002/api/v1/supplier/orders
```

### Интеграция с MP Proxy

**Вариант 1: Использовать mocktest из marketplaces.json**

```bash
# Запрос через proxy с использованием mocktest
curl -H "Authorization: Bearer <token>" \
  -H "msapimp-options: eyJwYWdpbmF0ZSI6dHJ1ZX0=" \
  "http://localhost:3000/api/v1/proxy/mocktest/api/v1/supplier/orders"
```

**Вариант 2: Временная замена baseUrl**

Обновите `config/marketplaces.json` для тестирования:

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

---

## 📦 Очистка package.json перед коммитом

Чтобы в репозиторий не попадали mock-скрипты и лишние команды, используйте:

```bash
# Очистить package.json перед коммитом/деплоем
npm run strip
```

**Что удаляется:**
- Mock-скрипты: `mock:install`, `mock:start`, `mock:dev`
- Копирование конфигов из `build`: остаётся просто `tsc`

После выполнения:
```bash
git add package.json
git commit -m "ваше сообщение"
```

> ⚠️ **Mock API не попадает в репозиторий** (добавлен в `.gitignore`).
> Каждый разработчик запускает локальную копию.


