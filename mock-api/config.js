/**
 * Конфигурация Mock API
 */
export const mockConfig = {
  // Базовая задержка ответа (мс)
  baseDelay: 100,
  
  // Случайная дополнительная задержка (мс)
  randomDelay: 400,
  
  // Доступные сценарии
  scenarios: [
    'success',      // Успешный ответ
    'error_400',    // Bad Request
    'error_401',    // Unauthorized
    'error_403',    // Forbidden
    'error_404',    // Not Found
    'error_429',    // Too Many Requests
    'error_500',    // Internal Server Error
    'error_502',    // Bad Gateway
    'error_503',    // Service Unavailable
    'error_504',    // Gateway Timeout
    'timeout',      // Таймаут соединения
    'slow'          // Медленный ответ (5 сек)
  ],
  
  // Пагинация по умолчанию
  pagination: {
    defaultLimit: 100,
    maxLimit: 1000,
    defaultOffset: 0
  }
};

/**
 * Генератор случайных данных
 */
export const randomUtils = {
  // Случайное число в диапазоне
  randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
  
  // Случайная дата
  randomDate: (daysBack = 30) => {
    const date = new Date();
    date.setDate(date.getDate() - randomUtils.randomInt(0, daysBack));
    return date.toISOString();
  },
  
  // Случайный элемент из массива
  randomItem: (array) => array[Math.floor(Math.random() * array.length)],
  
  // Генерация UUID
  uuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  }),
  
  // Случайный статус для теста
  randomStatus: () => {
    const statuses = ['new', 'processing', 'shipped', 'delivered', 'cancelled'];
    return randomUtils.randomItem(statuses);
  }
};
