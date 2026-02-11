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
    // Получаем список заказов, чтобы узнать их nmId и orderId
    let allOrders = [];
    let next = 0;
    let fetchCount = 0;
    const MAX_REQUESTS = 15;

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
    // Связываем orderId с баркодом стикера
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
      await new Promise(r => setTimeout(r, 50));
    }

    // --- 4. Получение фото и названий (Официальный Content API) ---
    // Используем тот же токен, так как у него есть права на Контент
    const nmIds = [...new Set(filteredOrders.map(o => o.nmId))];
    const productInfoMap = {};

    const nmChunks = [];
    for (let i = 0; i < nmIds.length; i += 100) nmChunks.push(nmIds.slice(i, i + 100));

    for (const chunk of nmChunks) {
        try {
            const contentUrl = 'https://content-api.wildberries.ru/content/v2/get/cards/list';
            const payload = {
                settings: {
                    cursor: { limit: 100 },
                    filter: {
                        withPhoto: -1, // Запрашиваем фото
                        nmID: chunk    // Фильтр по нашим артикулам
                    }
                }
            };
            
            const contentRes = await fetch(contentUrl, {
                method: 'POST',
                headers, // Тот же токен
                body: JSON.stringify(payload)
            });

            if (contentRes.ok) {
                const contentData = await contentRes.json();
                const cards = contentData.cards || [];
                cards.forEach(card => {
                    // Ищем самое большое фото или хотя бы какое-то
                    let photo = null;
                    if (card.photos && card.photos.length > 0) {
                         photo = card.photos[0].big || card.photos[0].c516x688 || card.photos[0].tm;
                    }
                    
                    productInfoMap[card.nmID] = {
                        title: card.title || card.subjectName || "", 
                        brand: card.brand || "",
                        imageUrl: photo
                    };
                });
            } else {
                console.warn(`Content API Error: ${contentRes.status}`, await contentRes.text());
                // Если ошибка (например, нет прав), мы просто продолжим и сработает fallback внизу
            }
        } catch (e) {
            console.error("Error fetching content info", e);
        }
    }

    // --- 5. Сборка ответа ---
    const mergedOrders = [];
    const barcodeMap = {};

    filteredOrders.forEach((ro) => {
      const stickerObj = allStickers.find((s) => s.orderId === ro.id);
      
      // Данные из Content API
      const info = productInfoMap[ro.nmId];
      
      // Fallback: Если Content API не вернул инфо, генерируем ссылку вручную и ставим заглушку заголовка
      const finalTitle = info?.title || `Товар ${ro.nmId}`;
      const finalBrand = info?.brand || '';
      const finalPhoto = info?.imageUrl || getWbImageUrl(ro.nmId); // Используем генератор как запасной вариант

      let displaySticker = String(ro.id);

      // Маппинг баркодов стикера
      if (stickerObj) {
        if (stickerObj.barcode) {
            const raw = stickerObj.barcode.trim();
            displaySticker = raw;
            barcodeMap[raw] = ro.id;
            barcodeMap[raw.replace(/^\*+|\*+$/g, '')] = ro.id;
        } else if (stickerObj.partA && stickerObj.partB) {
            const composite = `${stickerObj.partA}${stickerObj.partB}`;
            displaySticker = composite;
            barcodeMap[composite] = ro.id;
        }
      }
      
      barcodeMap[String(ro.id)] = ro.id;

      mergedOrders.push({
        id: ro.id,
        stickerId: displaySticker,
        article: ro.nmId ? ro.nmId.toString() : 'N/A',
        title: finalTitle,
        brand: finalBrand,
        price: ro.convertedPrice ? ro.convertedPrice / 100 : 0,
        photoUrl: finalPhoto,
        isSgtinRequired: true,
        status: 'pending' 
      });
    });

    return res.status(200).json({ orders: mergedOrders, map: barcodeMap });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}

// Запасной генератор ссылок (Fallback)
// Используется, если Content API не вернул фото или токен не подошел для контента
function getWbImageUrl(nmId) {
    const vol = Math.floor(nmId / 100000);
    const part = Math.floor(nmId / 1000);
    
    // Карта серверов (включая новые 2025 года)
    const hosts = [
        { range: [0, 143], host: 'basket-01.wbbasket.ru' },
        { range: [144, 287], host: 'basket-02.wbbasket.ru' },
        { range: [288, 431], host: 'basket-03.wbbasket.ru' },
        { range: [432, 719], host: 'basket-04.wbbasket.ru' },
        { range: [720, 1007], host: 'basket-05.wbbasket.ru' },
        { range: [1008, 1061], host: 'basket-06.wbbasket.ru' },
        { range: [1062, 1115], host: 'basket-07.wbbasket.ru' },
        { range: [1116, 1169], host: 'basket-08.wbbasket.ru' },
        { range: [1170, 1313], host: 'basket-09.wbbasket.ru' },
        { range: [1314, 1601], host: 'basket-10.wbbasket.ru' },
        { range: [1602, 1655], host: 'basket-11.wbbasket.ru' },
        { range: [1656, 1919], host: 'basket-12.wbbasket.ru' },
        { range: [1920, 2045], host: 'basket-13.wbbasket.ru' },
        { range: [2046, 2189], host: 'basket-14.wbbasket.ru' },
        { range: [2190, 2405], host: 'basket-15.wbbasket.ru' },
        { range: [2406, 2621], host: 'basket-16.wbbasket.ru' },
        { range: [2622, 2837], host: 'basket-17.wbbasket.ru' },
        { range: [2838, 3053], host: 'basket-18.wbbasket.ru' },
        { range: [3054, 3269], host: 'basket-19.wbbasket.ru' },
        { range: [3270, 3485], host: 'basket-20.wbbasket.ru' },
        { range: [3486, 3701], host: 'basket-21.wbbasket.ru' },
        { range: [3702, 3917], host: 'basket-22.wbbasket.ru' },
        { range: [3918, 4133], host: 'basket-23.wbbasket.ru' },
        { range: [4134, 4349], host: 'basket-24.wbbasket.ru' },
        { range: [4350, 4565], host: 'basket-25.wbbasket.ru' }
    ];

    const match = hosts.find(h => vol >= h.range[0] && vol <= h.range[1]);
    const host = match ? match.host : 'basket-25.wbbasket.ru';

    return `https://${host}/vol${vol}/part${part}/${nmId}/images/c516x688/1.jpg`;
}