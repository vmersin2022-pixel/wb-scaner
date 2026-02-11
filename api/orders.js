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

    // 1. Используем метод orders/new (все новые задания)
    const ordersUrl = `https://marketplace-api.wildberries.ru/api/v3/orders/new`;
    const ordersRes = await fetch(ordersUrl, { headers });

    if (!ordersRes.ok) {
      const errText = await ordersRes.text();
      // Если 404 здесь, значит эндпоинт вообще неправильный, но orders/new актуален
      return res.status(ordersRes.status).json({ error: `WB API Error (Orders): ${errText}` });
    }

    const ordersData = await ordersRes.json();
    let rawOrders = ordersData.orders || [];

    // 2. Фильтрация по supplyId на нашей стороне
    if (supplyId && supplyId.trim() !== '') {
      const target = supplyId.trim().toLowerCase();
      rawOrders = rawOrders.filter(o => o.supplyId && o.supplyId.toLowerCase().includes(target));
    }

    if (rawOrders.length === 0) {
      return res.status(200).json({ 
        orders: [], 
        map: {}, 
        message: 'Заказы по данной поставке не найдены среди новых' 
      });
    }

    // 3. Получение стикеров (баркодов)
    const orderIds = rawOrders.map((o) => o.id);
    const chunks = [];
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
        // ВАЖНО: поле называется stickers, а не data (согласно документации)
        if (stickersData.stickers) {
          allStickers = [...allStickers, ...stickersData.stickers];
        }
      }
      // Задержка против лимитов
      await new Promise(r => setTimeout(r, 100)); 
    }

    // 4. Сборка результата
    const mergedOrders = [];
    const barcodeMap = {};

    rawOrders.forEach((ro) => {
      const stickerObj = allStickers.find((s) => s.orderId === ro.id);
      
      let stickerCode = '';
      if (stickerObj && stickerObj.partA && stickerObj.partB) {
        stickerCode = `${stickerObj.partA}${stickerObj.partB}`;
      } else {
        stickerCode = String(ro.id);
      }
      
      // Фото товара
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
      // Ключи для карты поиска
      barcodeMap[stickerCode] = ro.id;
      // Иногда сканер читает иначе, можно добавлять вариации если нужно
    });

    return res.status(200).json({ orders: mergedOrders, map: barcodeMap });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}