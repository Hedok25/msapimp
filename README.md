## 🎯 Цель проекта

Разработать серверное приложение на **Node.js (TypeScript)** с использованием **SQLite + In-Memory**, выполняющее функцию **прозрачного прокси-сервиса** для маршрутизации запросов к внешним API маркетплейсов (5-10 МП). Сервис должен обеспечивать безопасность, отказоустойчивость, контроль частоты запросов и возможность масштабирования.

Использовать  better‑sqlite3, AdminJS
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
- **Access Token**: JWT, TTL 60 минут
- **Refresh Token**: Хранится в SQLite (хеши), TTL 7-30 дней

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
| `scope` | string[] | ✅ | Права доступа |-отдельно для каждого ендпоинта
| `rate_tier` | string | ✅ | Тариф: basic/premium/enterprise |
| `role` | string | ✅ | client/admin |

### Endpoints:
- `POST /auth/login` — получение пары токенов
- `POST /auth/refresh` — обновление access token
- `POST /auth/logout` — отзыв refresh token
- `GET /auth/me` — информация о клиенте

### Хранение:
- Refresh tokens: SQLite (таблица `refresh_tokens`, хеши)
- JWT blacklist: In-Memory + SQLite (отозванные токены)
- Auth logs: SQLite (таблица `auth_logs`, аудит событий)

### RBAC:
- **client**: доступ к прокси, своим запросам, DLQ
- **admin**: доступ ко всем запросам, управление лимитами, CB, логами

---

## 🛣️ 3. Маршрутизация (Path-based Routing)

### Формат запроса клиента:
```
MP URL:     https://api-seller.ozon.ru/v3/posting/fbs/list
Proxy URL:  https://proxy-service.com/ozon/v3/posting/fbs/list
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

## 📦 4. Управление опциями прокси (X-Proxy-Options)

### Заголовок:
- **Имя**: `X-Proxy-Options`
- **Формат**: JSON-объект, закодированный в **Base64**
- **Лимит**: 1 КБ (декодированный размер)

### Схема JSON (Zod-валидация):
```json
{
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

### Приоритет настроек:
1. **Заголовок X-Proxy-Options** (override)
2. **JWT Claims** `proxy_options`
3. **Конфиг в БД** (client_id, по умолчанию)

### Обработка ошибок:
- Ошибка декодирования → `400 Bad Request`
- Превышен лимит размера → `413 Payload Too Large`
- Неизвестные поля → игнорируются (warning в лог)

---

## 🚦 5. Rate Limiting (Иерархический)

### Уровни:
| Уровень | Ключ | Описание |
|---------|------|----------|
| Global IP | `ip` | Защита от DoS (1000 запросов/мин) |
| Client | `client_id:rate_tier` | По тарифу (basic/premium/enterprise) |
| Marketplace | `client_id:marketplace` | Соблюдение лимитов МП |
| Endpoint | `client_id:marketplace:endpoint` | Тонкая настройка |

### Тарифы (из JWT):
| Tier | Requests/Min | Concurrent | Burst |
|------|--------------|------------|-------|
| basic | 30 | 2 | 5 |
| premium | 100 | 5 | 15 |
| enterprise | 500 | 20 | 50 |

### Хранение:
- **In-Memory**: быстрая проверка, TTL = окно лимита
- **SQLite**: аудит, восстановление после рестарта
- **Синхронизация**: каждые 30 секунд (`INSERT … ON CONFLICT UPDATE`)
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
| SQLite (refresh_tokens) | 30 дней | `expires_at < NOW` |

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

### Этап 1: Ядро (1-2 недели)
- [ ] Базовая структура проекта (TypeScript + ESLint + Prettier)
- [ ] SQLite инициализация + базовые таблицы
- [ ] JWT аутентификация (login, refresh, middleware)
- [ ] Path-based routing (1 маркетплейс, например Ozon)
- [ ] Простая очередь (in-memory, без persistence)
- [ ] Health endpoint

**Definition of Done:**
- ✅ JWT auth работает
- ✅ 1 МП подключён
- ✅ Health endpoint возвращает 200

---

### Этап 2: Надёжность (1-2 недели)
- [ ] Rate Limiting (in-memory + SQLite sync)
- [ ] Retry с экспоненциальной задержкой (base: 2с, max: 5, jitter: ±20%)
- [ ] Dead Letter Queue (базовая версия)
- [ ] Circuit Breaker (на 1 МП)
- [ ] Логирование в SQLite + endpoints для чтения
- [ ] TTL Cleanup (фоновая задача)
- [ ] Load test (k6)

**Definition of Done:**
- ✅ Rate limit блокирует превышения
- ✅ Retry работает
- ✅ DLQ записывает ошибки
- ✅ Circuit Breaker переключает состояния

---

### Этап 3: Масштабирование (1-2 недели)
- [ ] Адаптеры для 3-5 маркетплейсов
- [ ] Конфигурация эндпоинтов (URL, лимиты, пагинация)
- [ ] X-Proxy-Options (Base64 JSON)
- [ ] Двухуровневая очередь (in-memory + SQLite persistence)
- [ ] Восстановление очереди после рестарта
- [ ] Graceful Shutdown (SIGTERM + SIGINT)
- [ ] Hot reload конфигурации

**Definition of Done:**
- ✅ 5+ МП подключены
- ✅ Очередь восстанавливается после рестарта
- ✅ X-Proxy-Options парсится
- ✅ Graceful Shutdown отрабатывает

---

### Этап 4: Продакшен (1-2 недели)
- [ ] Mock MP API (отдельный сервис)
- [ ] Integration и E2E тесты (покрытие ≥80%)
- [ ] Swagger документация
- [ ] Метрики Prometheus + алерты
- [ ] Уведомления (Webhook/Slack) при DLQ и Circuit Breaker
- [ ] Админ-эндпоинты (управление DLQ, лимитами, CB)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Docker конфигурация

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

---

## 🐳 17. Docker и CI/CD

### Docker Compose (Development):
```yaml
services:
  proxy:
    build: .
    ports: ["3000:3000"]
    volumes:
      - .//app/data
      - ./config:/app/config
    environment:
      - NODE_ENV=development
      - DB_PATH=/app/data/proxy.db
  
  mock-mp:
    build: ./mock-api
    ports: ["3001:3001"]
  
  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
```

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
| **Опции** | X-Proxy-Options (Base64 JSON, 1 КБ лимит) | ✅ |
| **Rate Limit** | SQLite + async-mutex, синхронизация 30 сек | ✅ |
| **Очередь** | 2 уровня, worker-pool, back-pressure | ✅ |
| **Circuit Breaker** | На МП, шардинг на эндпоинты при росте | ✅ |
| **DLQ** | Лимит 10000 записей, payload с контекстом | ✅ |
| **Валидация** | Zod-схемы в адаптерах | ✅ |
| **Логирование** | Structured, request_id в каждом логе | ✅ |
| **TTL Cleanup** | Max-batch-size: 1000 записей | ✅ |
| **Health** | Liveness + Readiness (ready флаг) | ✅ |
| **Shutdown** | SIGTERM + SIGINT обработчики | ✅ |
| **Тесты** | Fixture-модуль для Mock-MP | ✅ |
| **Swagger** | @fastify/swagger + OpenAPI annotations | ✅ |
| **Конфиг** | marketplaces.json + watcher (SIGHUP) | ✅ |
| **Таймауты** | 10 сек по умолчанию, override через опции | ✅ |
| **Файлы** | Stream-proxy до 50 МБ | ✅ |
| **Лимит тела** | 5 МБ по умолчанию | ✅ |
| **Версии API** | Версия в пути + адаптер | ✅ |
| **E2E** | Docker network: testnet | ✅ |
| **CI/CD** | GitHub Actions pipeline | ✅ |
| **Docker** | Dockerfile + docker-compose.yml | ✅ |
| **RBAC** | 2 роли: client, admin | ✅ |
| **Кэш** | LRU для GET-запросов, TTL 5 мин | ✅ |
| **Метрики** | Prometheus с лейблами | ✅ |
| **Load Test** | k6 после Этапа 2 | ✅ |

---

## 🎯 Рекомендация по старту

1. **Создать репозиторий** с указанной структурой папок
2. **Настроить CI/CD** (lint + test) сразу — дисциплина с первого дня
3. **Начать с Этапа 1** (Ядро) — 1 МП (Ozon), базовая аутентификация, простой роутинг
4. **Параллельно разработать Mock-MP** — для тестирования без реальных API
5. **После Этапа 2 запустить k6** — получить метрики для принятия решений о масштабировании
