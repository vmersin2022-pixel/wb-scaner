export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { token, supplyId } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Не указан токен' });
  }

  try {
    const headers = {
      'Authorization': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // 1. Получаем список заказов через /api/v3/orders (история/инфо)
    // Этот метод возвращает все заказы (включая "на сборке"), в отличие от /orders/new
    // Используем пагинацию, чтобы просмотреть последние заказы (по умолчанию API отдает за 30 дней)
    
    let allOrders = [];
    let next = 0;
    let fetchCount = 0;
    const MAX_REQUESTS = 10; // Ограничение: проверяем последние ~10,000 заказов, чтобы не было таймаута

    do {
        // limit=1000 - максимум API
        const ordersUrl = `https://marketplace-api.wildberries.ru/api/v3/orders?limit=1000&next=${next}`;
        const ordersRes = await fetch(ordersUrl, { headers });

        if (!ordersRes.ok) {
            const errText = await ordersRes.text();
            return res.status(ordersRes.status).json({ error: `WB API Error (Orders): ${errText}` });
        }

        const data = await ordersRes.json();
        const chunk = data.orders || [];
        allOrders = [...allOrders, ...chunk];
        
        next = data.next;
        fetchCount++;

        // Прерываем, если курсор 0 или данные кончились
    } while (next && next !== 0 && fetchCount < MAX_REQUESTS);

    // 2. Фильтрация по ID поставки (supplyId)
    let filteredOrders = [];
    if (supplyId && supplyId.trim() !== '') {
      const target = supplyId.trim();
      // Строгое сравнение ID поставки
      filteredOrders = allOrders.filter(o => o.supplyId === target);
    } else {
      // Если ID поставки не указан, возвращаем все найденные (резервный вариант)
      filteredOrders = allOrders;
    }

    if (filteredOrders.length === 0) {
      return res.status(200).json({ 
        orders: [], 
        map: {}, 
        message: 'Заказы по данной поставке не найдены (проверено за последние 30 дней)' 
      });
    }

    // 3. Получение стикеров (баркодов) для найденных заказов
    const orderIds = filteredOrders.map((o) => o.id);
    const chunks = [];
    // Лимит WB: 100 заказов за один запрос стикеров
    for (let i = 0; i < orderIds.length; i += 100) {
      chunks.push(orderIds.slice(i, i + 100));
    }

    let allStickers = [];

    for (const chunk of chunks) {
      const stickersUrl = `https://marketplace-api.wildberries.ru/api/v3/orders/stickers?type=svg&width=58&height=40`;
      const stickersRes = await fetch(stickersUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ orders: chunk })
      });

      if (stickersRes.ok) {
        const stickersData = await stickersRes.json();
        // ВАЖНО: используем поле .stickers согласно документации v3
        if (stickersData.stickers) {
          allStickers = [...allStickers, ...stickersData.stickers];
        }
      }
      // Небольшая задержка, чтобы не превысить лимиты API
      await new Promise(r => setTimeout(r, 100)); 
    }

    // 4. Сборка итогового ответа
    const mergedOrders = [];
    const barcodeMap = {};

    filteredOrders.forEach((ro) => {
      const stickerObj = allStickers.find((s) => s.orderId === ro.id);
      
      let stickerCode = '';
      if (stickerObj && stickerObj.partA && stickerObj.partB) {
        stickerCode = `${stickerObj.partA}${stickerObj.partB}`;
      } else {
        // Fallback, если стикер не найден (маловероятно для активных заказов)
        stickerCode = String(ro.id);
      }
      
      // Формирование ссылки на фото
      const vol = Math.floor(ro.nmId / 100000);
      const part = Math.floor(ro.nmId / 1000);
      const photoUrl = `https://basket-01.wb.ru/vol${vol}/part${part}/${ro.nmId}/images/c246x328/1.jpg`; 

      const order = {
        id: ro.id,
        stickerId: stickerCode,
        article: ro.nmId ? ro.nmId.toString() : 'N/A',
        title: `Товар ${ro.nmId}`, 
        price: ro.convertedPrice ? ro.convertedPrice / 100 : 0,
        photoUrl,
        isSgtinRequired: true,
        status: 'pending'
      };

      mergedOrders.push(order);
      barcodeMap[stickerCode] = ro.id;
    });

    return res.status(200).json({ orders: mergedOrders, map: barcodeMap });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}