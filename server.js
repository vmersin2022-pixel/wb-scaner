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
      filteredOrders = allOrders.filter(o => o.supplyId && o.supplyId.toLowerCase().includes(target));
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

    // 4. Content API (Photos & Metadata)
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
                        imageUrl: photo,
                        sizes: card.sizes || []
                    };
                });
            }
        } catch (e) { console.error("Content API Error", e); }
    }

    // 4.5. Fallback for Missing Info (Public Card JSON)
    // If Content API failed or returned incomplete data for some NMs, try to fetch from public JSON
    const missingNmIds = nmIds.filter(nm => !productInfoMap[nm] || !productInfoMap[nm].sizes || productInfoMap[nm].sizes.length === 0);
    
    if (missingNmIds.length > 0) {
        // Limit parallel requests to avoid timeouts (batches of 10)
        const batchSize = 10;
        for (let i = 0; i < missingNmIds.length; i += batchSize) {
             const batch = missingNmIds.slice(i, i + batchSize);
             await Promise.all(batch.map(async (nm) => {
                 try {
                     const host = getBasketHost(nm);
                     if (!host) return;
                     const vol = Math.floor(nm / 100000);
                     const part = Math.floor(nm / 1000);
                     const cardUrl = `https://${host}/vol${vol}/part${part}/${nm}/info/ru/card.json`;
                     
                     const cardRes = await fetch(cardUrl);
                     if (cardRes.ok) {
                         const cardData = await cardRes.json();
                         // Merge into productInfoMap
                         productInfoMap[nm] = {
                             title: cardData.subj_name || cardData.imt_name || "",
                             brand: cardData.selling?.brand_name || "",
                             imageUrl: productInfoMap[nm]?.imageUrl || `https://${host}/vol${vol}/part${part}/${nm}/images/c516x688/1.jpg`,
                             sizes: cardData.sizes ? cardData.sizes.map(s => ({
                                 chrtID: s.chrt_id || s.id, // Usually chrt_id in public json
                                 techSize: s.tech_size,
                                 wbSize: s.wb_size
                             })) : []
                         };
                     }
                 } catch (e) { /* ignore fallback errors */ }
             }));
        }
    }


    // 5. Assemble
    const mergedOrders = [];
    const barcodeMap = {};

    filteredOrders.forEach((ro) => {
      const stickerObj = allStickers.find((s) => s.orderId === ro.id);
      const info = productInfoMap[ro.nmId];
      
      const finalTitle = info?.title || `Товар ${ro.nmId}`;
      const finalBrand = info?.brand || '';
      // Fallback image generator if still null
      const finalPhoto = info?.imageUrl || generateWbImageUrl(ro.nmId);

      // Determine Size
      let finalSize = '';
      if (info && info.sizes && ro.chrtId) {
          // Public JSON usually uses chrt_id (number). FBS uses chrtId (number).
          // Content API uses chrtID (number).
          // We cast to String to be safe.
          const sizeObj = info.sizes.find(s => String(s.chrtID) === String(ro.chrtId));
          if (sizeObj) {
              finalSize = sizeObj.techSize || sizeObj.wbSize || '';
          }
      }

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
        size: finalSize,
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
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Helper: Get Host
function getBasketHost(nmId) {
    const vol = Math.floor(nmId / 100000);
    // Updated ranges 2024/2025
    if (vol <= 143) return 'basket-01.wbbasket.ru';
    if (vol <= 287) return 'basket-02.wbbasket.ru';
    if (vol <= 431) return 'basket-03.wbbasket.ru';
    if (vol <= 719) return 'basket-04.wbbasket.ru';
    if (vol <= 1007) return 'basket-05.wbbasket.ru';
    if (vol <= 1061) return 'basket-06.wbbasket.ru';
    if (vol <= 1115) return 'basket-07.wbbasket.ru';
    if (vol <= 1169) return 'basket-08.wbbasket.ru';
    if (vol <= 1313) return 'basket-09.wbbasket.ru';
    if (vol <= 1601) return 'basket-10.wbbasket.ru';
    if (vol <= 1655) return 'basket-11.wbbasket.ru';
    if (vol <= 1919) return 'basket-12.wbbasket.ru';
    if (vol <= 2045) return 'basket-13.wbbasket.ru';
    if (vol <= 2189) return 'basket-14.wbbasket.ru';
    if (vol <= 2405) return 'basket-15.wbbasket.ru';
    if (vol <= 2621) return 'basket-16.wbbasket.ru';
    if (vol <= 2837) return 'basket-17.wbbasket.ru';
    if (vol <= 3053) return 'basket-18.wbbasket.ru';
    if (vol <= 3269) return 'basket-19.wbbasket.ru';
    if (vol <= 3485) return 'basket-20.wbbasket.ru';
    if (vol <= 3701) return 'basket-21.wbbasket.ru';
    if (vol <= 3917) return 'basket-22.wbbasket.ru';
    if (vol <= 4133) return 'basket-23.wbbasket.ru';
    if (vol <= 4349) return 'basket-24.wbbasket.ru';
    if (vol <= 4565) return 'basket-25.wbbasket.ru';
    if (vol <= 4781) return 'basket-26.wbbasket.ru';
    if (vol <= 4997) return 'basket-27.wbbasket.ru';
    if (vol <= 5213) return 'basket-28.wbbasket.ru';
    if (vol <= 5429) return 'basket-29.wbbasket.ru';
    if (vol <= 5645) return 'basket-30.wbbasket.ru';
    if (vol <= 5861) return 'basket-31.wbbasket.ru';
    if (vol <= 6077) return 'basket-32.wbbasket.ru';
    if (vol <= 6293) return 'basket-33.wbbasket.ru';
    if (vol <= 6509) return 'basket-34.wbbasket.ru';
    if (vol <= 6725) return 'basket-35.wbbasket.ru';
    if (vol <= 6941) return 'basket-36.wbbasket.ru';
    if (vol <= 7157) return 'basket-37.wbbasket.ru';
    if (vol <= 7373) return 'basket-38.wbbasket.ru';
    if (vol <= 7589) return 'basket-39.wbbasket.ru';
    if (vol <= 7805) return 'basket-40.wbbasket.ru';
    if (vol <= 8021) return 'basket-41.wbbasket.ru';
    return 'basket-42.wbbasket.ru'; // Fallback for very new
}

function generateWbImageUrl(nmId) {
    const host = getBasketHost(nmId);
    const vol = Math.floor(nmId / 100000);
    const part = Math.floor(nmId / 1000);
    return `https://${host}/vol${vol}/part${part}/${nmId}/images/c516x688/1.jpg`;
}