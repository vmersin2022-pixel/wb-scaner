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

    // 1. Получаем список заказов через /api/v3/orders
    // Проходимся по страницам (пагинация), чтобы найти заказы нашей поставки
    let allOrders = [];
    let next = 0;
    let fetchCount = 0;
    const MAX_REQUESTS = 10; // Глубина поиска ~10,000 последних заказов

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

    // 2. Фильтрация по ID поставки
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
        message: 'Заказы по данной поставке не найдены (проверено за последние 30 дней)' 
      });
    }

    // 3. Получение стикеров
    const orderIds = filteredOrders.map((o) => o.id);
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
        // В разных версиях API поле может быть 'stickers' или 'data'
        if (stickersData.stickers) {
          allStickers = [...allStickers, ...stickersData.stickers];
        } else if (stickersData.data) {
          allStickers = [...allStickers, ...stickersData.data];
        }
      }
      await new Promise(r => setTimeout(r, 100)); 
    }

    // 4. Сборка карты баркодов
    const mergedOrders = [];
    const barcodeMap = {};

    filteredOrders.forEach((ro) => {
      const stickerObj = allStickers.find((s) => s.orderId === ro.id);
      
      // Базовый ключ - ID заказа
      barcodeMap[String(ro.id)] = ro.id;

      let displaySticker = String(ro.id);

      if (stickerObj) {
        // А. Используем поле 'barcode' (например "*C4Qe/fqT")
        // Это самое важное поле для сканирования QR с этикетки
        if (stickerObj.barcode) {
            const raw = stickerObj.barcode.trim();
            barcodeMap[raw] = ro.id;
            // Также добавляем вариант без звездочек (cleanBarcode на фронте может их убирать)
            barcodeMap[raw.replace(/^\*+|\*+$/g, '')] = ro.id;
            displaySticker = raw;
        }

        // Б. Используем комбинацию partA + partB (старый формат или запасной)
        if (stickerObj.partA && stickerObj.partB) {
            const composite = `${stickerObj.partA}${stickerObj.partB}`;
            barcodeMap[composite] = ro.id;
            // Если нет barcode, показываем это
            if (!stickerObj.barcode) displaySticker = composite;
        }
      }
      
      const vol = Math.floor(ro.nmId / 100000);
      const part = Math.floor(ro.nmId / 1000);
      const photoUrl = `https://basket-01.wb.ru/vol${vol}/part${part}/${ro.nmId}/images/c246x328/1.jpg`; 

      const order = {
        id: ro.id,
        stickerId: displaySticker,
        article: ro.nmId ? ro.nmId.toString() : 'N/A',
        title: `Товар ${ro.nmId}`, 
        price: ro.convertedPrice ? ro.convertedPrice / 100 : 0,
        photoUrl,
        isSgtinRequired: true,
        status: 'pending' // Можно доработать проверку статуса, если нужно
      };

      mergedOrders.push(order);
    });

    return res.status(200).json({ orders: mergedOrders, map: barcodeMap });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}