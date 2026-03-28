# Тестовые запросы к MP Proxy Service API

## Файлы

- `wildberries.http` - HTTP запросы для расширения REST Client (VS Code)
- `test-wildberries.js` - Node.js скрипт для автоматического тестирования

## Использование REST Client (VS Code)

1. Установите расширение [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client)
2. Откройте файл `wildberries.http`
3. Нажмите `Send Request` над каждым запросом

### Настройка

Замените значения переменных в начале файла:
```http
@adminEmail = ваш_email
@adminPassword = ваш_пароль
@wbApiKey = ваш_wildberries_api_key
```

## Использование Node.js скрипта

### Предварительные требования

- Node.js 18+ (с поддержкой fetch API)
- Запущенный MP Proxy Service

### Запуск

```bash
# Установите API ключ Wildberries через переменную окружения
set WB_API_KEY=ваш_wildberries_api_key

# Запустите тесты
node tests/requests/test-wildberries.js
```

Или для PowerShell:
```powershell
$env:WB_API_KEY="ваш_wildberries_api_key"
node tests/requests/test-wildberries.js
```

## Доступные эндпоинты Wildberries Statistics API

| Эндпоинт | Описание |
|----------|----------|
| `/api/v1/supplier/orders` | Данные о заказах |
| `/api/v1/supplier/products` | Данные о товарах |
| `/api/v1/supplier/stocks` | Остатки на складах |
| `/api/v1/supplier/cardorders` | Заказы по карточкам |
| `/api/v1/supplier/returns` | Возвраты |
| `/api/v1/supplier/reports` | Отчёты |

## Параметры запросов

- `dateFrom` - Дата начала периода (формат: `YYYY-MM-DDTHH:MM:SS`)
- `dateTo` - Дата окончания периода (опционально)

## Пример запроса через curl

```bash
# 1. Получение токена
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@mp-proxy.local\",\"password\":\"admin123\"}"

# 2. Запрос к WB API (замените TOKEN на полученный access_token)
curl -X GET http://localhost:3000/api/v1/proxy/statistics-api.wildberries.ru/api/v1/supplier/products \
  -H "Authorization: Bearer TOKEN" \
  -H "X-API-Key: ваш_wildberries_api_key"
```
