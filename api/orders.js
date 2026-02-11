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

    // 1. Используем метод orders/new вместо устаревшего supplies/{id}/orders
    // Этот метод возвращает все новые сборочные задания
    const ordersUrl = `https://marketplace-api.wildberries.ru/api/v3/orders/new`;
    const ordersRes = await fetch(ordersUrl, { headers });

    if (!ordersRes.ok) {
      const errText = await ordersRes.text();
      return res.status(ordersRes.status).json({ error: `WB API Error: ${errText}` });
    }

    const ordersData = await ordersRes.json();
    let rawOrders = ordersData.orders || [];

    // 2. Фильтрация на сервере (так как API отдает всё подряд)
    // Если supplyId передан, ищем совпадения. Если нет - берем всё.
    if (supplyId && supplyId.trim() !== '') {
      const target = supplyId.trim().toLowerCase();
      rawOrders = rawOrders.filter(o => o.supplyId && o.supplyId.toLowerCase().includes(target));
    }

    if (rawOrders.length === 0) {
      return res.status(200).json({ 
        orders: [], 
        map: {}, 
        message: 'Заказы по данной поставке не найдены' 
      });
    }

    // 3. Получение стикеров (для баркодов)
    const orderIds = rawOrders.map((o) => o.id);
    const chunks = [];
    // Разбиваем по 100 ID, чтобы не превысить лимиты WB
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
        if (stickersData.data) {
          allStickers = [...allStickers, ...stickersData.data];
        }
      }
      // Небольшая задержка, чтобы не спамить API
      await new Promise(r => setTimeout(r, 100)); 
    }

    // 4. Сборка данных
    const mergedOrders = [];
    const barcodeMap = {};

    rawOrders.forEach((ro) => {
      const stickerObj = allStickers.find((s) => s.orderId === ro.id);
      
      let stickerCode = '';
      if (stickerObj && stickerObj.partA && stickerObj.partB) {
        stickerCode = `${stickerObj.partA}${stickerObj.partB}`;
      } else {
        // Fallback если стикер не нашелся, используем ID заказа как ключ (маловероятно для сканера)
        stickerCode = String(ro.id);
      }
      
      const vol = Math.floor(ro.nmId / 100000);
      const part = Math.floor(ro.nmId / 1000);
      const photoUrl = `https://basket-01.wb.ru/vol${vol}/part${part}/${ro.nmId}/images/c246x328/1.jpg`; 

      const order = {
        id: ro.id,
        stickerId: stickerCode,
        article: ro.nmId ? ro.nmId.toString() : 'N/A',
        title: `Товар ${ro.nmId}`, // WB API orders/new не всегда отдает название, берем ID
        price: ro.convertedPrice ? ro.convertedPrice / 100 : 0,
        photoUrl,
        isSgtinRequired: true, // В рамках задачи считаем что всем нужен КИЗ
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