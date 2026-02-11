import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- API: ORDERS HANDLER ---
app.post('/api/orders', async (req, res) => {
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

    // 1. Get Orders
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

    // 2. Filter by Supply
    let filteredOrders = [];
    if (supplyId && supplyId.trim() !== '') {
      const target = supplyId.trim().toLowerCase();
      filteredOrders = allOrders.filter(o => o.supplyId && o.supplyId.toLowerCase() === target);
    } else {
      filteredOrders = allOrders;
    }

    if (filteredOrders.length === 0) {
      return res.status(200).json({ orders: [], map: {}, message: 'Заказы не найдены' });
    }

    // 3. Get Stickers
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

    // 4. Content API (Photos & Vendor Code fallback)
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
                    filter: { withPhoto: -1, nmID: chunk }
                }
            };
            const contentRes = await fetch(contentUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (contentRes.ok) {
                const contentData = await contentRes.json();
                const cards = contentData.cards || [];
                cards.forEach(card => {
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
            }
        } catch (e) { console.error(e); }
    }

    // 5. Assemble
    const mergedOrders = [];
    const barcodeMap = {};

    filteredOrders.forEach((ro) => {
      const stickerObj = allStickers.find((s) => s.orderId === ro.id);
      const info = productInfoMap[ro.nmId];
      
      const finalTitle = info?.title || `Товар ${ro.nmId}`;
      const finalBrand = info?.brand || '';
      const finalPhoto = info?.imageUrl || getWbImageUrl(ro.nmId);

      let displaySticker = String(ro.id);

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
        vendorCode: ro.article || '',
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
});

// --- API: BIND HANDLER ---
app.post('/api/bind', async (req, res) => {
  const { token, orderId, kiz } = req.body;
  if (!token || !orderId || !kiz) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const url = `https://marketplace-api.wildberries.ru/api/v3/orders/${orderId}/meta/sgtin`;
    const wbRes = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sgtins: [kiz] })
    });

    if (!wbRes.ok) {
      const errText = await wbRes.text();
      return res.status(wbRes.status).json({ error: errText });
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// --- SERVE FRONTEND ---
// Serve static files from the React build directory
app.use(express.static(path.join(__dirname, 'dist')));

// Handle React routing, return all requests to React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Helper for fallback images
function getWbImageUrl(nmId) {
    const vol = Math.floor(nmId / 100000);
    const part = Math.floor(nmId / 1000);
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
