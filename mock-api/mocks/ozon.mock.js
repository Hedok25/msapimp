import { randomUtils } from '../config.js';

/**
 * Mock данные для Ozon
 */
const mockData = {
  postings: [],
  products: []
};

// Генерация тестовых данных
function generateMockData() {
  // Генерация постингов (заказов)
  for (let i = 0; i < 300; i++) {
    mockData.postings.push({
      posting_number: `FBS-${randomUtils.randomInt(10000000, 99999999)}/${randomUtils.randomInt(1, 99)}`,
      order_number: `${randomUtils.randomInt(1000000, 9999999)}`,
      status: randomUtils.randomItem(['awaiting_packaging', 'awaiting_deliver', 'delivered', 'cancelled']),
      status_name: randomUtils.randomItem(['Ожидает упаковки', 'Ожидает передачи', 'Доставлен', 'Отменён']),
      created_at: randomUtils.randomDate(30),
      in_process_at: randomUtils.randomDate(25),
      products: [
        {
          product_id: randomUtils.randomInt(100000, 999999),
          offer_id: `OFFER-${randomUtils.randomInt(1000, 9999)}`,
          name: `Товар ${randomUtils.randomInt(1, 100)}`,
          price: String(randomUtils.randomInt(100, 5000)),
          quantity: randomUtils.randomInt(1, 5)
        }
      ],
      buyer: {
        name: 'Иванов Иван'
      },
      delivery_method: {
        id: randomUtils.randomInt(1, 10),
        name: randomUtils.randomItem(['ПВЗ', 'Курьер', 'Постамат'])
      },
      warehouse: randomUtils.randomItem(['Москва', 'Санкт-Петербург', 'Екатеринбург']),
      ship_from: randomUtils.randomItem(['Москва', 'Санкт-Петербург']),
      deliver_to: randomUtils.randomItem(['Москва', 'Санкт-Петербург', 'Екатеринбург', 'Казань'])
    });
  }

  // Генерация товаров
  for (let i = 0; i < 150; i++) {
    mockData.products.push({
      product_id: randomUtils.randomInt(100000, 999999),
      offer_id: `OFFER-${randomUtils.randomInt(1000, 9999)}`,
      name: `Товар ${randomUtils.randomInt(1, 100)}`,
      price: String(randomUtils.randomInt(100, 5000)),
      old_price: String(randomUtils.randomInt(200, 6000)),
      premium_price: String(randomUtils.randomInt(150, 5500)),
      stocks: [
        {
          type: 'fbs',
          present: randomUtils.randomInt(0, 100),
          reserved: randomUtils.randomInt(0, 20)
        }
      ],
      is_fbo_visible: false,
      is_fbs_visible: true,
      created_at: randomUtils.randomDate(60),
      updated_at: randomUtils.randomDate(5)
    });
  }
}

// Инициализация данных
generateMockData();

/**
 * Обработчики эндпоинтов Ozon
 */
export const OzonMock = {
  /**
   * POST /v3/posting/fbs/list
   * Получение списка заказов
   */
  getPostingList: (req, res) => {
    const { 
      dir = 'ASC', 
      limit = 100, 
      offset = 0, 
      since, 
      to,
      status 
    } = req.body || {};
    
    let postings = mockData.postings;
    
    // Фильтрация по статусу
    if (status) {
      postings = postings.filter(p => p.status === status);
    }
    
    // Фильтрация по дате
    if (since) {
      const sinceDate = new Date(since);
      postings = postings.filter(p => new Date(p.created_at) >= sinceDate);
    }
    
    if (to) {
      const toDate = new Date(to);
      postings = postings.filter(p => new Date(p.created_at) <= toDate);
    }
    
    // Сортировка
    postings.sort((a, b) => {
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      return dir === 'ASC' ? dateA - dateB : dateB - dateA;
    });
    
    // Пагинация
    const total = postings.length;
    const paginatedPostings = postings.slice(
      parseInt(offset), 
      parseInt(offset) + parseInt(limit)
    );
    
    res.json({
      postings: paginatedPostings,
      total: total,
      last_id: String(parseInt(offset) + parseInt(limit))
    });
  },

  /**
   * POST /v3/posting/fbs/get
   * Получение информации о заказе
   */
  getPosting: (req, res) => {
    const { posting_number } = req.body || {};
    
    const posting = mockData.postings.find(p => p.posting_number === posting_number);
    
    if (!posting) {
      return res.status(404).json({
        error: {
          code: 'POSTING_NOT_FOUND',
          message: 'Posting not found'
        }
      });
    }
    
    res.json(posting);
  },

  /**
   * POST /v1/product/list
   * Получение списка товаров
   */
  getProducts: (req, res) => {
    const { 
      filter = {}, 
      last_id = '', 
      limit = 100 
    } = req.body || {};
    
    let products = mockData.products;
    
    // Фильтрация по visibility
    if (filter.visibility !== undefined) {
      products = products.filter(p => 
        filter.visibility === 'visible' ? p.is_fbs_visible : !p.is_fbs_visible
      );
    }
    
    // Пагинация
    const offset = last_id ? parseInt(last_id) : 0;
    const paginatedProducts = products.slice(offset, offset + parseInt(limit));
    
    res.json({
      products: paginatedProducts,
      total: products.length,
      last_id: String(offset + parseInt(limit))
    });
  },

  /**
   * POST /v1/product/info/stocks
   * Получение остатков товаров
   */
  getStocks: (req, res) => {
    const { offer_id, product_id } = req.body || {};
    
    let products = mockData.products;
    
    // Фильтрация по товару
    if (offer_id) {
      products = products.filter(p => p.offer_id === offer_id);
    }
    
    if (product_id) {
      products = products.filter(p => p.product_id === parseInt(product_id));
    }
    
    // Формируем ответ с остатками
    const result = products.map(p => ({
      product_id: p.product_id,
      offer_id: p.offer_id,
      stocks: p.stocks
    }));
    
    res.json({
      items: result,
      total: result.length
    });
  }
};
