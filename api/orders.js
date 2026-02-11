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

    // --- 1. Получение заказов (FBS API) ---
    let allOrders = [];
    let next = 0;
    let fetchCount = 0;
    const MAX_REQUESTS = 10; 

    do {
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
    } while (next && next !== 0 && fetchCount < MAX_REQUESTS);

    // --- 2. Фильтрация по поставке ---
    let filteredOrders = [];
    if (supplyId && supplyId.trim() !== '') {
      const target = supplyId.trim().toLowerCase();
      filteredOrders = allOrders.filter(o => o.supplyId && o.supplyId.toLowerCase() === target);
    } else {
      filteredOrders = allOrders;
    }

    if (filteredOrders.length === 0) {
      return res.status(200).json({ 
        orders: [], 
        map: {}, 
        message: 'Заказы по данной поставке не найдены' 
      });
    }

    // --- 3. Получение стикеров (FBS API) ---
    const orderIds = filteredOrders.map((o) => o.id);
    const chunks = [];
    for (let i = 0; i < orderIds.length; i += 100) chunks.push(orderIds.slice(i, i + 100));

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
        if (stickersData.stickers) allStickers.push(...stickersData.stickers);
        else if (stickersData.data) allStickers.push(...stickersData.data);
      }
      await new Promise(r => setTimeout(r, 50)); // Анти-флуд
    }

    // --- 4. Обогащение данными (Public Card API) ---
    // Собираем уникальные nmId для запроса инфо о товарах
    const nmIds = [...new Set(filteredOrders.map(o => o.nmId))];
    const productInfoMap = {};

    // Разбиваем на пачки по 50 nmId для запроса к card.wb.ru
    const nmChunks = [];
    for (let i = 0; i < nmIds.length; i += 50) nmChunks.push(nmIds.slice(i, i + 50));

    for (const chunk of nmChunks) {
        try {
            const nmString = chunk.join(';');
            // Используем публичное API карточек WB v2
            const cardUrl = `https://card.wb.ru/cards/v2/detail?appType=1&curr=rub&dest=-1257786&nm=${nmString}`;
            const cardRes = await fetch(cardUrl);
            if (cardRes.ok) {
                const cardData = await cardRes.json();
                const products = cardData.data?.products || [];
                products.forEach(p => {
                    productInfoMap[p.id] = {
                        title: p.name,
                        brand: p.brand,
                        // Определяем хост для картинки (basket-01, basket-02 и т.д.)
                        imageUrl: getWbImageUrl(p.id)
                    };
                });
            }
        } catch (e) {
            console.error("Error fetching card info", e);
        }
    }

    // --- 5. Сборка ответа ---
    const mergedOrders = [];
    const barcodeMap = {};

    filteredOrders.forEach((ro) => {
      // Ищем стикер
      const stickerObj = allStickers.find((s) => s.orderId === ro.id);
      
      // Ищем инфо о товаре
      const info = productInfoMap[ro.nmId] || {};
      
      // Определяем штрихкод для карты
      let mapKeySticker = String(ro.id);
      let displaySticker = String(ro.id);

      if (stickerObj) {
        if (stickerObj.barcode) {
            const raw = stickerObj.barcode.trim();
            mapKeySticker = raw;
            displaySticker = raw;
            
            // Добавляем в карту и "чистый" вариант, и сырой
            barcodeMap[raw] = ro.id;
            barcodeMap[raw.replace(/^\*+|\*+$/g, '')] = ro.id;
        } else if (stickerObj.partA && stickerObj.partB) {
            const composite = `${stickerObj.partA}${stickerObj.partB}`;
            mapKeySticker = composite;
            displaySticker = composite;
            barcodeMap[composite] = ro.id;
        }
      }
      
      // Всегда добавляем ID заказа как резервный ключ
      barcodeMap[String(ro.id)] = ro.id;

      // Формируем финальный объект
      const order = {
        id: ro.id,
        stickerId: displaySticker,
        article: ro.nmId ? ro.nmId.toString() : 'N/A',
        // Если есть название из публичного API, берем его, иначе генерим заглушку
        title: info.title || `Товар ${ro.nmId}`, 
        brand: info.brand || '',
        price: ro.convertedPrice ? ro.convertedPrice / 100 : 0,
        // Если есть фото из публичного API, берем его, иначе старый метод
        photoUrl: info.imageUrl || getWbImageUrl(ro.nmId),
        isSgtinRequired: true,
        status: 'pending' 
      };

      mergedOrders.push(order);
    });

    return res.status(200).json({ orders: mergedOrders, map: barcodeMap });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}

// Хелпер для определения правильного домена корзины WB
function getWbImageUrl(nmId) {
    const vol = Math.floor(nmId / 100000);
    const part = Math.floor(nmId / 1000);
    
    let host = 'basket-01.wb.ru';
    if (vol >= 0 && vol <= 143) host = 'basket-01.wb.ru';
    else if (vol >= 144 && vol <= 287) host = 'basket-02.wb.ru';
    else if (vol >= 288 && vol <= 431) host = 'basket-03.wb.ru';
    else if (vol >= 432 && vol <= 719) host = 'basket-04.wb.ru';
    else if (vol >= 720 && vol <= 1007) host = 'basket-05.wb.ru';
    else if (vol >= 1008 && vol <= 1061) host = 'basket-06.wb.ru';
    else if (vol >= 1062 && vol <= 1115) host = 'basket-07.wb.ru';
    else if (vol >= 1116 && vol <= 1169) host = 'basket-08.wb.ru';
    else if (vol >= 1170 && vol <= 1313) host = 'basket-09.wb.ru';
    else if (vol >= 1314 && vol <= 1601) host = 'basket-10.wb.ru';
    else if (vol >= 1602 && vol <= 1655) host = 'basket-11.wb.ru';
    else if (vol >= 1656 && vol <= 1919) host = 'basket-12.wb.ru';
    else if (vol >= 1920 && vol <= 2045) host = 'basket-13.wb.ru';
    else if (vol >= 2046 && vol <= 2189) host = 'basket-14.wb.ru';
    else if (vol >= 2190 && vol <= 2405) host = 'basket-15.wb.ru';
    else if (vol >= 2406 && vol <= 2621) host = 'basket-16.wb.ru';
    else if (vol >= 2622 && vol <= 2837) host = 'basket-17.wb.ru';
    else host = 'basket-18.wb.ru'; // Fallback для новых

    return `https://${host}/vol${vol}/part${part}/${nmId}/images/c516x688/1.jpg`;
}