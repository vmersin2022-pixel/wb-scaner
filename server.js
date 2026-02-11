import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- DATABASE CONFIGURATION ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const hasSupabase = !!(supabaseUrl && supabaseKey);

let supabase = null;
if (hasSupabase) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey);
        console.log("✅ Using Supabase Database");
    } catch (e) {
        console.error("❌ Failed to init Supabase client:", e.message);
    }
} else {
    console.log("⚠️ Supabase credentials missing. Using In-Memory Storage (Data will be lost on restart).");
}

// --- IN-MEMORY FALLBACK STORE ---
const memoryStore = {
    orders: new Map(), // id -> { id, status, scanned_kiz, synced_to_wb }
    content: new Map() // nmId -> { title, brand, imageUrl, sizes }
};

// --- HELPER FUNCTIONS ---

function getBasketHost(nmId) {
    const vol = Math.floor(nmId / 100000);
    const hosts = [
        { r: 143, h: 'basket-01.wbbasket.ru' },
        { r: 287, h: 'basket-02.wbbasket.ru' },
        { r: 431, h: 'basket-03.wbbasket.ru' },
        { r: 719, h: 'basket-04.wbbasket.ru' },
        { r: 1007, h: 'basket-05.wbbasket.ru' },
        { r: 1061, h: 'basket-06.wbbasket.ru' },
        { r: 1115, h: 'basket-07.wbbasket.ru' },
        { r: 1169, h: 'basket-08.wbbasket.ru' },
        { r: 1313, h: 'basket-09.wbbasket.ru' },
        { r: 1601, h: 'basket-10.wbbasket.ru' },
        { r: 1655, h: 'basket-11.wbbasket.ru' },
        { r: 1919, h: 'basket-12.wbbasket.ru' },
        { r: 2045, h: 'basket-13.wbbasket.ru' },
        { r: 2189, h: 'basket-14.wbbasket.ru' },
        { r: 2405, h: 'basket-15.wbbasket.ru' },
        { r: 2621, h: 'basket-16.wbbasket.ru' },
        { r: 2837, h: 'basket-17.wbbasket.ru' },
        { r: 3053, h: 'basket-18.wbbasket.ru' },
        { r: 3269, h: 'basket-19.wbbasket.ru' },
        { r: 3485, h: 'basket-20.wbbasket.ru' },
        { r: 3701, h: 'basket-21.wbbasket.ru' },
        { r: 3917, h: 'basket-22.wbbasket.ru' },
        { r: 4133, h: 'basket-23.wbbasket.ru' },
        { r: 4349, h: 'basket-24.wbbasket.ru' },
        { r: 4565, h: 'basket-25.wbbasket.ru' }
    ];
    const match = hosts.find(h => vol <= h.r);
    return match ? match.h : 'basket-25.wbbasket.ru';
}

function generateWbImageUrl(nmId) {
    const host = getBasketHost(nmId);
    const vol = Math.floor(nmId / 100000);
    const part = Math.floor(nmId / 1000);
    return `https://${host}/vol${vol}/part${part}/${nmId}/images/c516x688/1.webp`;
}

// --- DATABASE OPERATIONS (Unified) ---
async function getCachedContent(nmIds) {
    if (hasSupabase && supabase) {
        const { data } = await supabase.from('content_cache').select('*').in('nm_id', nmIds);
        const map = {};
        if (data) {
            data.forEach(item => {
                map[item.nm_id] = {
                    title: item.title,
                    brand: item.brand,
                    imageUrl: item.photo_url,
                    sizes: item.sizes_json
                };
            });
        }
        return map;
    } else {
        const map = {};
        nmIds.forEach(id => {
            if (memoryStore.content.has(id)) {
                map[id] = memoryStore.content.get(id);
            }
        });
        return map;
    }
}

async function upsertContent(items) {
    if (hasSupabase && supabase) {
        const rows = items.map(i => ({
            nm_id: i.nmID,
            title: i.title,
            brand: i.brand,
            photo_url: i.imageUrl,
            sizes_json: i.sizes_json
        }));
        await supabase.from('content_cache').upsert(rows, { onConflict: 'nm_id' });
    } else {
        items.forEach(i => {
            memoryStore.content.set(i.nmID, {
                title: i.title,
                brand: i.brand,
                imageUrl: i.imageUrl,
                sizes: i.sizes_json
            });
        });
    }
}

async function getExistingOrders(ids) {
    if (hasSupabase && supabase) {
        const { data } = await supabase.from('orders').select('id, status, scanned_kiz').in('id', ids);
        const map = {};
        if (data) data.forEach(o => map[o.id] = o);
        return map;
    } else {
        const map = {};
        ids.forEach(id => {
            if (memoryStore.orders.has(id)) {
                map[id] = memoryStore.orders.get(id);
            }
        });
        return map;
    }
}

async function upsertOrder(orderData) {
    if (hasSupabase && supabase) {
        await supabase.from('orders').upsert(orderData, { onConflict: 'id' });
    } else {
        // Only update if not exists or if we are changing status
        const existing = memoryStore.orders.get(orderData.id) || {};
        memoryStore.orders.set(orderData.id, { ...existing, ...orderData });
    }
}

// --- WORKER (RETRY LOGIC) ---
// Only runs if DB is available
setInterval(async () => {
    if (hasSupabase && supabase) {
        try {
            const { data: pending, error } = await supabase.from('orders').select('*').eq('status', 'done').eq('synced_to_wb', false);
            if (error || !pending || pending.length === 0) return;
            
            for (const order of pending) {
                if (!order.token || !order.scanned_kiz) continue;
                try {
                    const wbRes = await fetch(`https://marketplace-api.wildberries.ru/api/v3/orders/${order.id}/meta/sgtin`, {
                        method: 'PUT',
                        headers: { 'Authorization': order.token, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sgtins: [order.scanned_kiz] })
                    });
                    if (wbRes.ok) {
                        await supabase.from('orders').update({ synced_to_wb: true }).eq('id', order.id);
                        console.log(`[Worker] Synced ${order.id}`);
                    }
                } catch (e) {}
                await new Promise(r => setTimeout(r, 500)); // Rate limit protection
            }
        } catch(e) {}
    }
}, 60000);


// --- API ROUTES ---

// 1. SYNC ORDERS
app.post('/api/orders', async (req, res) => {
  const { token, supplyId } = req.body;
  if (!token) return res.status(400).json({ error: 'Не указан токен' });

  try {
    const headers = { 'Authorization': token, 'Content-Type': 'application/json' };

    // --- NEW: CHECK SUPPLY STATUS ---
    // Проверяем, не закрыта ли поставка, чтобы не показывать 0/256 для уже сданных
    if (supplyId) {
        try {
            const sid = supplyId.trim();
            const sRes = await fetch(`https://marketplace-api.wildberries.ru/api/v3/supplies/${sid}`, { headers });
            
            if (sRes.ok) {
                const sData = await sRes.json();
                if (sData.closedAt || sData.done === true) {
                    return res.status(409).json({ 
                        error: "Поставка уже закрыта (в доставке/принята).",
                        isClosed: true 
                    });
                }
            } else if (sRes.status === 404) {
                 console.warn(`Supply ${sid} check 404. Proceeding anyway.`);
            }
        } catch (e) {
            console.warn("Supply status check failed:", e.message);
        }
    }
    
    // A. Fetch Orders
    let allOrders = [];
    let next = 0;
    let fetchCount = 0;
    try {
        do {
            const r = await fetch(`https://marketplace-api.wildberries.ru/api/v3/orders?limit=1000&next=${next}`, { headers });
            if (!r.ok) break;
            const d = await r.json();
            allOrders = [...allOrders, ...(d.orders || [])];
            next = d.next;
            fetchCount++;
        } while (next && next !== 0 && fetchCount < 10);
    } catch (fetchErr) {
        console.error("WB API Fetch Error:", fetchErr);
        return res.status(502).json({ error: "Ошибка соединения с WB API" });
    }

    if (allOrders.length === 0) {
        return res.json({ orders: [], map: {} });
    }

    // B. Filter
    // 1. By Supply ID
    // 2. EXCLUDE Canceled (isCancel === true)
    // 3. EXCLUDE New/Unconfirmed (userStatus === 0) - because user wants "Assembly" items only
    // 4. EXCLUDE Sold/Delivering (userStatus > 1) just in case
    let filteredOrders = allOrders;
    
    if (supplyId && supplyId.trim()) {
        const t = supplyId.trim().toLowerCase();
        filteredOrders = allOrders.filter(o => {
            // Must match Supply ID
            const matchSupply = o.supplyId && o.supplyId.toLowerCase().includes(t);
            if (!matchSupply) return false;

            // Strict Status Filters
            if (o.isCancel === true) return false; // Exclude client cancellations
            
            // userStatus 0 = New (Not yet on assembly)
            // userStatus 1 = On Assembly
            // We only want 1.
            if (typeof o.userStatus !== 'undefined') {
                 if (o.userStatus === 0) return false; // Hide "New" (6 items in screenshot)
                 if (o.userStatus >= 2) return false;  // Hide "Delivering/Sold"
            }

            return true;
        });
    }

    if (filteredOrders.length === 0) {
        return res.json({ orders: [], map: {} });
    }

    // C. Fetch Stickers
    const orderIds = filteredOrders.map(o => o.id);
    const stickersMap = {}; 
    
    // Chunk requests for stickers
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
    const contentMap = await getCachedContent(nmIds);

    nmIds.forEach(nm => { if (!contentMap[nm]) missingNmIds.push(nm); });

    if (missingNmIds.length > 0) {
        // Chunk requests for content
        for (let i = 0; i < missingNmIds.length; i += 100) {
            const chunk = missingNmIds.slice(i, i + 100);
            try {
                const r = await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list', {
                    method: 'POST', headers, body: JSON.stringify({ settings: { cursor: { limit: 100 }, filter: { withPhoto: -1, nmID: chunk } } })
                });
                if (r.ok) {
                    const d = await r.json();
                    const cards = d.cards || [];
                    const itemsToCache = [];

                    for (const card of cards) {
                        let photo = null;
                        if (card.photos?.length) photo = card.photos[0].big || card.photos[0].tm;
                        
                        const info = {
                            nmID: card.nmID,
                            title: card.title || card.subjectName || "",
                            brand: card.brand || "",
                            imageUrl: photo,
                            sizes_json: card.sizes || []
                        };
                        itemsToCache.push(info);
                        contentMap[card.nmID] = info;
                    }
                    if (itemsToCache.length > 0) await upsertContent(itemsToCache);
                }
            } catch (e) { }
        }
    }

    // F. Final Assembly
    const finalOrders = [];
    const barcodeMap = {};
    const existingOrdersMap = await getExistingOrders(filteredOrders.map(o => o.id));

    for (const order of filteredOrders) {
        const info = contentMap[order.nmId] || {};
        const sticker = stickersMap[order.id] || String(order.id);
        
        let size = '';
        if (info.sizes_json) {
            const sizeArr = Array.isArray(info.sizes_json) ? info.sizes_json : [];
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

        const existing = existingOrdersMap[order.id];
        if (existing && existing.status === 'done') {
            status = 'done';
            kiz = existing.scanned_kiz;
        }

        // Save order structure to DB/Memory for later
        await upsertOrder({
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

    res.json({ orders: finalOrders, map: barcodeMap });

  } catch (e) {
    console.error("Critical Server Error:", e);
    res.status(500).json({ error: e.message });
  }
});


// 2. BIND KIZ
app.post('/api/bind', async (req, res) => {
  const { token, orderId, kiz } = req.body;
  if (!token || !orderId || !kiz) return res.status(400).json({ error: 'Missing data' });

  try {
    // DB Update
    if (hasSupabase && supabase) {
        const { error } = await supabase.from('orders').update({ 
            status: 'done', scanned_kiz: kiz, synced_to_wb: false, token: token 
        }).eq('id', orderId);
        if (error) throw error;
    } else {
        const existing = memoryStore.orders.get(orderId) || {};
        memoryStore.orders.set(orderId, { ...existing, status: 'done', scanned_kiz: kiz, synced_to_wb: false, token: token });
    }

    // Try Sync
    try {
        const url = `https://marketplace-api.wildberries.ru/api/v3/orders/${orderId}/meta/sgtin`;
        const wbRes = await fetch(url, {
          method: 'PUT',
          headers: { 'Authorization': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sgtins: [kiz] })
        });

        if (wbRes.ok) {
            if (hasSupabase && supabase) {
                await supabase.from('orders').update({ synced_to_wb: true }).eq('id', orderId);
            } else {
                const o = memoryStore.orders.get(orderId);
                if (o) o.synced_to_wb = true;
            }
        }
    } catch (e) { console.error("WB Sync Error:", e); }

    res.json({ success: true });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

app.listen(PORT, () => console.log(`Server running on ${PORT}`));