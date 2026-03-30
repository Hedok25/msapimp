# 🎭 Mock MP API

Mock API для тестирования MP Proxy Service. Симулирует ответы маркетплейсов (Wildberries, Ozon) с различными сценариями.

## 🚀 Быстрый старт

```bash
# Установка зависимостей
npm install

# Запуск (порт 3001)
npm start

# Запуск в режиме разработки (auto-reload)
npm run dev
```

## 📡 Endpoints

### Wildberries

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/v1/supplier/orders` | GET | Заказы продавца |
| `/api/v1/supplier/products` | GET | Товары продавца |
| `/api/v1/supplier/stocks` | GET | Остатки на складах |
| `/api/v1/supplier/cardorders` | GET | Заказы по карточкам |
| `/api/v1/supplier/returns` | GET | Возвраты |

### Ozon

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/v3/posting/fbs/list` | POST | Список заказов FBS |
| `/v3/posting/fbs/get` | POST | Информация о заказе |
| `/v1/product/list` | POST | Список товаров |
| `/v1/product/info/stocks` | POST | Остатки товаров |

### Общие

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/health` | GET | Health check |
| `/scenarios` | GET | Доступные сценарии |

## 🎬 Сценарии тестирования

Для тестирования различных ситуаций используйте заголовок `X-Mock-Scenario`:

```bash
# Успешный ответ (по умолчанию)
curl http://localhost:3001/api/v1/supplier/orders

# Ошибка 500
curl -H "X-Mock-Scenario: error_500" \
  http://localhost:3001/api/v1/supplier/orders

# Ошибка 429 (Too Many Requests)
curl -H "X-Mock-Scenario: error_429" \
  http://localhost:3001/api/v1/supplier/orders

# Таймаут
curl -H "X-Mock-Scenario: timeout" \
  http://localhost:3001/api/v1/supplier/orders
```

### Доступные сценарии:

| Сценарий | Описание |
|----------|----------|
| `success` | Успешный ответ (200) |
| `error_400` | Bad Request (400) |
| `error_401` | Unauthorized (401) |
| `error_403` | Forbidden (403) |
| `error_404` | Not Found (404) |
| `error_429` | Too Many Requests (429) |
| `error_500` | Internal Server Error (500) |
| `error_502` | Bad Gateway (502) |
| `error_503` | Service Unavailable (503) |
| `error_504` | Gateway Timeout (504) |
| `timeout` | Таймаут соединения (30 сек) |
| `slow` | Медленный ответ (5 сек) |

## 📊 Примеры запросов

### Wildberries Orders с пагинацией

```bash
# Первая страница (100 заказов)
curl "http://localhost:3001/api/v1/supplier/orders?limit=100&offset=0"

# Вторая страница
curl "http://localhost:3001/api/v1/supplier/orders?limit=100&offset=100"

# Заказы с определённой даты
curl "http://localhost:3001/api/v1/supplier/orders?dateFrom=2026-03-01&limit=50"
```

### Ozon Posting List

```bash
curl -X POST http://localhost:3001/v3/posting/fbs/list \
  -H "Content-Type: application/json" \
  -d '{
    "dir": "ASC",
    "limit": 100,
    "offset": 0,
    "since": "2026-03-01T00:00:00Z"
  }'
```

### Тестирование пагинации MP Proxy

```bash
# Запрос через proxy с пагинацией
curl -H "Authorization: Bearer <token>" \
  -H "msapimp-options: eyJwYWdpbmF0ZSI6dHJ1ZSwibGltaXQiOjEwMH0=" \
  "http://localhost:3000/api/v1/proxy/statistics-api.wildberries.ru/api/v1/supplier/orders"

# Получение результатов пагинации
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/v1/pagination/groups/<group_id>/results"
```

## ⚙️ Конфигурация

### Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `MOCK_PORT` | Порт сервера | 3001 |

### Настройки в `config.js`

```javascript
export const mockConfig = {
  baseDelay: 100,        // Базовая задержка (мс)
  randomDelay: 400,      // Случайная задержка (мс)
  pagination: {
    defaultLimit: 100,
    maxLimit: 1000
  }
};
```

## 🔧 Интеграция с MP Proxy

### docker-compose.yml (локальный запуск)

```yaml
version: '3.8'

services:
  mock-api:
    build: ./mock-api
    ports:
      - "3001:3001"
    environment:
      - MOCK_PORT=3001

  mp-proxy:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - mock-api
    environment:
      - DB_PATH=./data/proxy.db
```

### marketplaces.json (конфигурация proxy)

```json
{
  "marketplaces": [
    {
      "id": "statistics-api.wildberries.ru",
      "name": "Wildberries Statistics",
      "baseUrl": "http://localhost:3001/api/v1",
      "version": "v1"
    },
    {
      "id": "api-seller.ozon.ru",
      "name": "Ozon Seller",
      "baseUrl": "http://localhost:3001",
      "version": "v3"
    }
  ]
}
```

## 📝 Генерация тестовых данных

Mock API автоматически генерирует тестовые данные при запуске:

- **Orders**: 500 заказов за последние 30 дней
- **Products**: 200 товаров
- **Stocks**: 100 записей об остатках
- **Postings**: 300 заказов Ozon

Данные генерируются случайно при каждом запуске.

## 🐛 Отладка

### Логирование запросов

Все запросы логируются в консоль:

```
[2026-03-29T12:00:00.000Z] GET /api/v1/supplier/orders
[2026-03-29T12:00:01.000Z] POST /v3/posting/fbs/list
```

### Проверка доступности

```bash
curl http://localhost:3001/health

# Ответ:
{
  "status": "ok",
  "timestamp": "2026-03-29T12:00:00.000Z",
  "mock": true
}
```

## 📦 Зависимости

- `express` — веб-фреймворк
- `cors` — middleware для CORS

## ⚠️ Ограничения

- Данные хранятся только в памяти (сбрасываются при рестарте)
- Нет персистентности между запусками
- Не все параметры API поддерживаются
- Нет аутентификации

---

**Mock API создан для тестирования и не предназначен для production!**
