import { randomUtils } from '../config.js';

/**
 * Mock данные для Wildberries
 */
const mockData = {
  orders: [],
  products: [],
  stocks: [],
  cardOrders: []
};

// Генерация тестовых данных
function generateMockData() {
  // Генерация заказов
  for (let i = 0; i < 500; i++) {
    mockData.orders.push({
      date: randomUtils.randomDate(30),
      lastChangeDate: randomUtils.randomDate(10),
      warehouseName: randomUtils.randomItem(['Коледино', 'Электросталь', 'Краснодар', 'Казань']),
      warehouseType: 'Склад WB',
      countryName: 'Россия',
      oblastOkrugName: randomUtils.randomItem(['Центральный федеральный округ', 'Южный федеральный округ']),
      regionName: randomUtils.randomItem(['Москва', 'Московская область', 'Краснодарский край']),
      supplierArticle: `ART-${randomUtils.randomInt(10000, 99999)}`,
      nmId: randomUtils.randomInt(100000000, 999999999),
      barcode: `${randomUtils.randomInt(1000000000000, 9999999999999)}`,
      category: randomUtils.randomItem(['Одежда', 'Обувь', 'Дом и сад', 'Электроника']),
      subject: randomUtils.randomItem(['Футболка', 'Джинсы', 'Кроссовки']),
      brand: randomUtils.randomItem(['Brand A', 'Brand B', 'Brand C']),
      techSize: randomUtils.randomItem(['S', 'M', 'L', 'XL']),
      isSupply: false,
      isRealization: true,
      totalPrice: randomUtils.randomInt(500, 5000),
      discountPercent: randomUtils.randomInt(10, 50),
      spp: randomUtils.randomInt(5, 30),
      finishedPrice: randomUtils.randomInt(400, 4000),
      priceWithDisc: randomUtils.randomInt(300, 3500),
      isCancel: Math.random() < 0.05,
      cancelDate: Math.random() < 0.05 ? randomUtils.randomDate(5) : '',
      sticker: randomUtils.randomInt(10000000000, 99999999999),
      gNumber: `${randomUtils.randomInt(1000000000000000000, 9999999999999999999)}`,
      srid: randomUtils.uuid()
    });
  }

  // Генерация товаров
  for (let i = 0; i < 200; i++) {
    mockData.products.push({
      article: `ART-${randomUtils.randomInt(10000, 99999)}`,
      barcode: `${randomUtils.randomInt(1000000000000, 9999999999999)}`,
      brand: randomUtils.randomItem(['Brand A', 'Brand B', 'Brand C']),
      category: randomUtils.randomItem(['Одежда', 'Обувь', 'Дом и сад']),
      subject: randomUtils.randomItem(['Футболка', 'Джинсы']),
      techSize: randomUtils.randomItem(['S', 'M', 'L', 'XL']),
      colors: [randomUtils.randomItem(['red', 'blue', 'green', 'black'])],
      photo: `https://example.com/photo${i}.jpg`,
      supplierArticle: `SUP-${randomUtils.randomInt(1000, 9999)}`
    });
  }

  // Генерация остатков
  for (let i = 0; i < 100; i++) {
    mockData.stocks.push({
      warehouse: randomUtils.randomItem(['Коледино', 'Электросталь', 'Краснодар']),
      warehouseId: randomUtils.randomInt(1, 100),
      subject: randomUtils.randomItem(['Футболка', 'Джинсы']),
      category: randomUtils.randomItem(['Одежда', 'Обувь']),
      supplierArticle: `ART-${randomUtils.randomInt(10000, 99999)}`,
      barcode: `${randomUtils.randomInt(1000000000000, 9999999999999)}`,
      quantity: randomUtils.randomInt(0, 500),
      inWay: randomUtils.randomInt(0, 100)
    });
  }
}

// Инициализация данных
generateMockData();

/**
 * Обработчики эндпоинтов Wildberries
 */
export const WildberriesMock = {
  /**
   * GET /api/v1/supplier/orders
   * Параметры: dateFrom, flag, limit, offset
   */
  getOrders: (req, res) => {
    const { dateFrom, limit = 100, offset = 0 } = req.query;
    
    let orders = mockData.orders;
    
    // Фильтрация по дате
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      orders = orders.filter(o => new Date(o.date) >= fromDate);
    }
    
    // Пагинация
    const total = orders.length;
    const paginatedOrders = orders.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    // Проверка на последнюю страницу
    const hasMore = parseInt(offset) + parseInt(limit) < total;
    
    res.set('X-RateLimit-Remaining', Math.floor(Math.random() * 100));
    res.set('X-RateLimit-Limit', '100');
    
    res.json(paginatedOrders);
  },

  /**
   * GET /api/v1/supplier/products
   */
  getProducts: (req, res) => {
    const { limit = 100, offset = 0 } = req.query;
    
    const total = mockData.products.length;
    const paginatedProducts = mockData.products.slice(
      parseInt(offset), 
      parseInt(offset) + parseInt(limit)
    );
    
    res.json(paginatedProducts);
  },

  /**
   * GET /api/v1/supplier/stocks
   */
  getStocks: (req, res) => {
    const { limit = 100, offset = 0 } = req.query;
    
    const total = mockData.stocks.length;
    const paginatedStocks = mockData.stocks.slice(
      parseInt(offset), 
      parseInt(offset) + parseInt(limit)
    );
    
    res.json(paginatedStocks);
  },

  /**
   * GET /api/v1/supplier/cardorders
   */
  getCardOrders: (req, res) => {
    const { dateFrom, limit = 100, offset = 0 } = req.query;
    
    let orders = mockData.cardOrders.length > 0 ? mockData.cardOrders : mockData.orders;
    
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      orders = orders.filter(o => new Date(o.date) >= fromDate);
    }
    
    const paginatedOrders = orders.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    res.json(paginatedOrders);
  },

  /**
   * GET /api/v1/supplier/returns
   */
  getReturns: (req, res) => {
    const { dateFrom, limit = 100, offset = 0 } = req.query;
    
    // Возвраты — это заказы с isCancel = true
    let returns = mockData.orders.filter(o => o.isCancel);
    
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      returns = returns.filter(o => new Date(o.cancelDate) >= fromDate);
    }
    
    const paginatedReturns = returns.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    res.json(paginatedReturns);
  }
};
