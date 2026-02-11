import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- DATABASE SETUP ---
const DATA_DIR = process.env.AMVERA ? '/data' : __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const DB_PATH = path.join(DATA_DIR, 'warehouse.db');
const db = new sqlite3.Database(DB_PATH);

// Initialize Tables
db.serialize(() => {
  // Orders Table
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    supply_id TEXT,
    nm_id INTEGER,
    sticker_id TEXT,
    vendor_code TEXT,
    title TEXT,
    brand TEXT,
    photo_url TEXT,
    size TEXT,
    chrt_id INTEGER,
    skus TEXT,
    price REAL,
    status TEXT DEFAULT 'pending',
    scanned_kiz TEXT,
    synced_to_wb INTEGER DEFAULT 0,
    token TEXT, 
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // Migration: Add token column if it doesn't exist (for existing DBs)
  db.run("ALTER TABLE orders ADD COLUMN token TEXT", (err) => {
      // Ignore error if column already exists
  });

  // Content Cache Table
  db.run(`CREATE TABLE IF NOT EXISTS content_cache (
    nm_id INTEGER PRIMARY KEY,
    title TEXT,
    brand TEXT,
    photo_url TEXT,
    sizes_json TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- HELPERS ---
const runQuery = (query, params = []) => new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
        if (err) reject(err);
        else resolve(this);
    });
});

const getQuery = (query, params = []) => new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

const allQuery = (query, params = []) => new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

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
    // Updated to WEBP for better performance and to avoid 404s on new items
    return `https://${host}/vol${vol}/part${part}/${nmId}/images/c516x688/1.webp`;
}

// --- BACKGROUND WORKER (RETRY LOGIC) ---
// Runs every 60 seconds to retry failed KIZ submissions
setInterval(async () => {
    try {
        const pendingOrders = await allQuery(`SELECT * FROM orders WHERE status = 'done' AND synced_to_wb = 0`);
        if (pendingOrders.length === 0) return;

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
                    await runQuery('UPDATE orders SET synced_to_wb = 1 WHERE id = ?', [order.id]);
                    console.log(`[Worker] Synced order ${order.id} successfully.`);
                } else {
                    console.warn(`[Worker] Failed to sync ${order.id}: ${await wbRes.text()}`);
                }
            } catch (err) {
                console.error(`[Worker] Network error for ${order.id}:`, err.message);
            }
            // Polite delay between requests
            await new Promise(r => setTimeout(r, 500));
        }
    } catch (e) {
        console.error("[Worker] Error:", e);
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

    for (const nm of nmIds) {
        const cached = await getQuery('SELECT * FROM content_cache WHERE nm_id = ?', [nm]);
        if (cached) {
            contentMap[nm] = { 
                title: cached.title, 
                brand: cached.brand, 
                imageUrl: cached.photo_url,
                sizes: JSON.parse(cached.sizes_json || '[]')
            };
        } else {
            missingNmIds.push(nm);
        }
    }

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
                    for (const card of cards) {
                        let photo = null;
                        if (card.photos?.length) photo = card.photos[0].big || card.photos[0].tm;
                        
                        const info = {
                            title: card.title || card.subjectName || "",
                            brand: card.brand || "",
                            imageUrl: photo,
                            sizes_json: JSON.stringify(card.sizes || [])
                        };

                        await runQuery(`INSERT OR REPLACE INTO content_cache (nm_id, title, brand, photo_url, sizes_json) VALUES (?, ?, ?, ?, ?)`,
                            [card.nmID, info.title, info.brand, info.imageUrl, info.sizes_json]
                        );

                        contentMap[card.nmID] = { ...info, sizes: card.sizes || [] };
                    }
                }
            } catch (e) { }
        }
    }

    // F. MERGE & UPSERT
    const finalOrders = [];
    const barcodeMap = {};

    await runQuery('BEGIN TRANSACTION');

    for (const order of filteredOrders) {
        const info = contentMap[order.nmId] || {};
        const sticker = stickersMap[order.id] || String(order.id);
        
        let size = '';
        if (info.sizes) {
            const sObj = info.sizes.find(s => 
                String(s.chrtID) === String(order.chrtId) || 
                (s.skus && order.skus && s.skus.some(sku => order.skus.includes(sku)))
            );
            if (sObj) size = sObj.techSize || sObj.wbSize;
        }

        const title = info.title || `Товар ${order.nmId}`;
        const brand = info.brand || '';
        const photo = info.imageUrl || generateWbImageUrl(order.nmId);

        const existing = await getQuery('SELECT status, scanned_kiz FROM orders WHERE id = ?', [order.id]);
        
        let status = 'pending';
        let kiz = null;

        if (existing && existing.status === 'done') {
            status = 'done';
            kiz = existing.scanned_kiz;
        }

        // SAVE TOKEN HERE for the background worker
        await runQuery(`INSERT OR REPLACE INTO orders (
            id, supply_id, nm_id, sticker_id, vendor_code, title, brand, photo_url, size, chrt_id, skus, price, status, scanned_kiz, token
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            order.id, order.supplyId, order.nmId, sticker, order.article, 
            title, brand, photo, size, order.chrtId, 
            JSON.stringify(order.skus || []), order.convertedPrice / 100,
            status, kiz, token 
        ]);

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

    await runQuery('COMMIT');

    res.json({ orders: finalOrders, map: barcodeMap });

  } catch (e) {
    await runQuery('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


// 2. BIND KIZ
app.post('/api/bind', async (req, res) => {
  const { token, orderId, kiz } = req.body;
  if (!token || !orderId || !kiz) return res.status(400).json({ error: 'Missing data' });

  try {
    const dupe = await getQuery('SELECT id, sticker_id FROM orders WHERE scanned_kiz = ? AND id != ?', [kiz, orderId]);
    if (dupe) {
        return res.status(409).json({ error: `КИЗ уже привязан к заказу ${dupe.sticker_id}!` });
    }

    // Save token as well to ensure worker has latest token for this order
    await runQuery('UPDATE orders SET status = "done", scanned_kiz = ?, synced_to_wb = 0, token = ? WHERE id = ?', [kiz, token, orderId]);

    const url = `https://marketplace-api.wildberries.ru/api/v3/orders/${orderId}/meta/sgtin`;
    const wbRes = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sgtins: [kiz] })
    });

    if (!wbRes.ok) {
        // Failed to sync immediately, but saved to DB. Worker will pick it up.
        console.warn("WB Bind Error (Immediate):", await wbRes.text());
    } else {
        await runQuery('UPDATE orders SET synced_to_wb = 1 WHERE id = ?', [orderId]);
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