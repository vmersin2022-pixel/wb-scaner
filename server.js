import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- SUPABASE SETUP ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn("WARNING: SUPABASE_URL or SUPABASE_KEY is missing. Database features will fail.");
}

const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Helper: Get Host for Image Fallback
function getBasketHost(nmId) {
    const vol = Math.floor(nmId / 100000);
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
    return 'basket-42.wbbasket.ru';
}

function generateWbImageUrl(nmId) {
    const host = getBasketHost(nmId);
    const vol = Math.floor(nmId / 100000);
    const part = Math.floor(nmId / 1000);
    return `https://${host}/vol${vol}/part${part}/${nmId}/images/c516x688/1.webp`;
}

// --- BACKGROUND WORKER (RETRY LOGIC) ---
setInterval(async () => {
    try {
        const { data: pendingOrders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('status', 'done')
            .eq('synced_to_wb', false);
        
        if (error) throw error;
        if (!pendingOrders || pendingOrders.length === 0) return;

        console.log(`[Worker] Found ${pendingOrders.length} unsynced orders. Retrying...`);

        for (const order of pendingOrders) {
            if (!order.token || !order.scanned_kiz) continue;

            try {
                const wbRes = await fetch(`https://marketplace-api.wildberries.ru/api/v3/orders/${order.id}/meta/sgtin`, {
                    method: 'PUT',
                    headers: { 'Authorization': order.token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sgtins: [order.scanned_kiz] })
                });

                if (wbRes.ok) {
                    await supabase.from('orders').update({ synced_to_wb: true }).eq('id', order.id);
                    console.log(`[Worker] Synced order ${order.id} successfully.`);
                } else {
                    console.warn(`[Worker] Failed to sync ${order.id}: ${await wbRes.text()}`);
                }
            } catch (err) {
                console.error(`[Worker] Network error for ${order.id}:`, err.message);
            }
            await new Promise(r => setTimeout(r, 500));
        }
    } catch (e) {
        console.error("[Worker] Error:", e.message);
    }
}, 60000);


// --- API ROUTES ---

// 1. SYNC ORDERS
app.post('/api/orders', async (req, res) => {
  const { token, supplyId } = req.body;
  if (!token) return res.status(400).json({ error: 'Не указан токен' });

  try {
    const headers = { 'Authorization': token, 'Content-Type': 'application/json' };
    
    // A. Fetch Orders
    let allOrders = [];
    let next = 0;
    let fetchCount = 0;
    do {
        const r = await fetch(`https://marketplace-api.wildberries.ru/api/v3/orders?limit=1000&next=${next}`, { headers });
        if (!r.ok) break;
        const d = await r.json();
        allOrders = [...allOrders, ...(d.orders || [])];
        next = d.next;
        fetchCount++;
    } while (next && next !== 0 && fetchCount < 10);

    // B. Filter
    let filteredOrders = allOrders;
    if (supplyId && supplyId.trim()) {
        const t = supplyId.trim().toLowerCase();
        filteredOrders = allOrders.filter(o => o.supplyId && o.supplyId.toLowerCase().includes(t));
    }

    // C. Fetch Stickers
    const orderIds = filteredOrders.map(o => o.id);
    const stickersMap = {}; 
    
    for (let i = 0; i < orderIds.length; i += 100) {
        const chunk = orderIds.slice(i, i + 100);
        try {
            const r = await fetch(`https://marketplace-api.wildberries.ru/api/v3/orders/stickers?type=svg&width=58&height=40`, {
                method: 'POST', headers, body: JSON.stringify({ orders: chunk })
            });
            if (r.ok) {
                const d = await r.json();
                const list = d.stickers || d.data || [];
                list.forEach(s => {
                    let code = String(s.orderId);
                    if (s.barcode) code = s.barcode.trim();
                    else if (s.partA && s.partB) code = `${s.partA}${s.partB}`;
                    stickersMap[s.orderId] = code;
                });
            }
        } catch (e) {}
    }

    // D. Fetch Content
    const nmIds = [...new Set(filteredOrders.map(o => o.nmId))];
    const missingNmIds = [];
    const contentMap = {};

    // Check Cache in Supabase
    const { data: cachedItems } = await supabase.from('content_cache').select('*').in('nm_id', nmIds);
    if (cachedItems) {
        cachedItems.forEach(item => {
            contentMap[item.nm_id] = {
                title: item.title,
                brand: item.brand,
                imageUrl: item.photo_url,
                sizes: item.sizes_json // Already JSONB in Supabase, auto-parsed by JS client? Yes usually.
            };
        });
    }

    // Determine missing
    nmIds.forEach(nm => {
        if (!contentMap[nm]) missingNmIds.push(nm);
    });

    // Fetch missing from WB
    if (missingNmIds.length > 0) {
        for (let i = 0; i < missingNmIds.length; i += 100) {
            const chunk = missingNmIds.slice(i, i + 100);
            try {
                const r = await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list', {
                    method: 'POST', headers, body: JSON.stringify({ settings: { cursor: { limit: 100 }, filter: { withPhoto: -1, nmID: chunk } } })
                });
                if (r.ok) {
                    const d = await r.json();
                    const cards = d.cards || [];
                    const cacheUpserts = [];

                    for (const card of cards) {
                        let photo = null;
                        if (card.photos?.length) photo = card.photos[0].big || card.photos[0].tm;
                        
                        const info = {
                            title: card.title || card.subjectName || "",
                            brand: card.brand || "",
                            imageUrl: photo,
                            sizes_json: card.sizes || [] // Pass object, Supabase handles JSONB
                        };

                        cacheUpserts.push({
                            nm_id: card.nmID,
                            title: info.title,
                            brand: info.brand,
                            photo_url: info.imageUrl,
                            sizes_json: info.sizes_json
                        });

                        contentMap[card.nmID] = { ...info, sizes: card.sizes || [] };
                    }
                    if (cacheUpserts.length > 0) {
                        await supabase.from('content_cache').upsert(cacheUpserts, { onConflict: 'nm_id' });
                    }
                }
            } catch (e) { }
        }
    }

    // F. MERGE & UPSERT to Supabase
    const finalOrders = [];
    const barcodeMap = {};
    const dbUpserts = [];

    // Get existing statuses to preserve 'done'
    const { data: existingOrders } = await supabase
        .from('orders')
        .select('id, status, scanned_kiz')
        .in('id', filteredOrders.map(o => o.id));
    
    const existingMap = {};
    if (existingOrders) {
        existingOrders.forEach(o => existingMap[o.id] = o);
    }

    for (const order of filteredOrders) {
        const info = contentMap[order.nmId] || {};
        const sticker = stickersMap[order.id] || String(order.id);
        
        let size = '';
        if (info.sizes) {
            // Note: info.sizes might be array (if from fetch) or object (if from JSONB check depends on driver). 
            // supabase-js returns JSONB as object/array automatically.
            const sizeArr = Array.isArray(info.sizes) ? info.sizes : [];
            const sObj = sizeArr.find(s => 
                String(s.chrtID) === String(order.chrtId) || 
                (s.skus && order.skus && s.skus.some(sku => order.skus.includes(sku)))
            );
            if (sObj) size = sObj.techSize || sObj.wbSize;
        }

        const title = info.title || `Товар ${order.nmId}`;
        const brand = info.brand || '';
        const photo = info.imageUrl || generateWbImageUrl(order.nmId);

        let status = 'pending';
        let kiz = null;

        const existing = existingMap[order.id];
        if (existing && existing.status === 'done') {
            status = 'done';
            kiz = existing.scanned_kiz;
        }

        dbUpserts.push({
            id: order.id,
            supply_id: order.supplyId,
            nm_id: order.nmId,
            sticker_id: sticker,
            vendor_code: order.article,
            title: title,
            brand: brand,
            photo_url: photo,
            size: size,
            chrt_id: order.chrtId,
            skus: order.skus || [],
            price: order.convertedPrice / 100,
            status: status,
            scanned_kiz: kiz,
            token: token
        });

        finalOrders.push({
            id: order.id,
            stickerId: sticker,
            article: String(order.nmId),
            vendorCode: order.article || '',
            title, brand, size,
            price: order.convertedPrice / 100,
            photoUrl: photo,
            status,
            sgtin: kiz,
            isSgtinRequired: true
        });

        const cleanSticker = sticker.replace(/^\*+|\*+$/g, '');
        barcodeMap[sticker] = order.id;
        barcodeMap[cleanSticker] = order.id;
        barcodeMap[String(order.id)] = order.id;
    }

    // Bulk Upsert
    if (dbUpserts.length > 0) {
        const { error } = await supabase.from('orders').upsert(dbUpserts, { onConflict: 'id' });
        if (error) throw error;
    }

    res.json({ orders: finalOrders, map: barcodeMap });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


// 2. BIND KIZ
app.post('/api/bind', async (req, res) => {
  const { token, orderId, kiz } = req.body;
  if (!token || !orderId || !kiz) return res.status(400).json({ error: 'Missing data' });

  try {
    // Check duplicates
    const { data: dupe } = await supabase
        .from('orders')
        .select('id, sticker_id')
        .eq('scanned_kiz', kiz)
        .neq('id', orderId) // Ensure it's not the same order
        .single();

    if (dupe) {
        return res.status(409).json({ error: `КИЗ уже привязан к заказу ${dupe.sticker_id}!` });
    }

    // Update DB first
    const { error: updateErr } = await supabase
        .from('orders')
        .update({ status: 'done', scanned_kiz: kiz, synced_to_wb: false, token: token })
        .eq('id', orderId);
    
    if (updateErr) throw updateErr;

    // Try Sync
    const url = `https://marketplace-api.wildberries.ru/api/v3/orders/${orderId}/meta/sgtin`;
    const wbRes = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sgtins: [kiz] })
    });

    if (!wbRes.ok) {
        console.warn("WB Bind Error (Immediate):", await wbRes.text());
        // Do not fail request, worker will retry
    } else {
        await supabase.from('orders').update({ synced_to_wb: true }).eq('id', orderId);
    }

    res.json({ success: true });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

app.listen(PORT, () => console.log(`Server running on ${PORT}`));