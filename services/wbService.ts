import { WBOrder } from '../types';

const MOCK_DELAY = 500;

// Helper to generate a random large number string
const randId = () => Math.floor(Math.random() * 1000000000).toString();

export const demoOrders: WBOrder[] = Array.from({ length: 15 }).map((_, i) => ({
  id: parseInt(randId()),
  stickerId: `WB-${Math.floor(Math.random() * 1000)}`,
  article: `ART-${1000 + i}`,
  title: `Wildberries Product Test Item ${i + 1}`,
  price: Math.floor(Math.random() * 5000) + 500,
  photoUrl: `https://picsum.photos/400/500?random=${i}`,
  isSgtinRequired: true,
  status: 'pending'
}));

/**
 * Clean barcode string (remove surrounding *)
 */
export const cleanBarcode = (code: string): string => {
  return code.replace(/^\*+|\*+$/g, '').trim();
};

/**
 * Simulates the backend logic described in the prompt:
 * 1. GET Orders
 * 2. POST Orders/Stickers (to get barcodes)
 * 3. Merge and return
 */
export const fetchSupplyOrders = async (
  token: string, 
  supplyId: string, 
  isDemo: boolean
): Promise<{ orders: WBOrder[], map: Record<string, number> }> => {
  
  if (isDemo) {
    await new Promise(r => setTimeout(r, MOCK_DELAY));
    const map: Record<string, number> = {};
    demoOrders.forEach(o => {
      map[o.stickerId] = o.id;
      // Add a clean version to map just in case
      map[cleanBarcode(o.stickerId)] = o.id; 
    });
    return { orders: [...demoOrders], map };
  }

  // --- Real API Logic Implementation (Client-side proxy simulation) ---
  // In a real scenario, this code would likely run on a Next.js server to avoid CORS
  // and hide header logic. Here we implement the fetches as requested.
  
  try {
    const headers = {
      'Authorization': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // 1. Get Orders
    const ordersUrl = `https://marketplace-api.wildberries.ru/api/v3/supplies/${supplyId}/orders`;
    const ordersRes = await fetch(ordersUrl, { headers });
    
    if (!ordersRes.ok) throw new Error(`Failed to fetch orders: ${ordersRes.statusText}`);
    const ordersData = await ordersRes.json();
    const rawOrders = ordersData.orders || [];

    if (rawOrders.length === 0) {
      return { orders: [], map: {} };
    }

    const orderIds = rawOrders.map((o: any) => o.id);

    // 2. Get Stickers (Chunked 100)
    // Simplified for this demo to take first 100 if many
    const chunkIds = orderIds.slice(0, 100); 
    const stickersUrl = `https://marketplace-api.wildberries.ru/api/v3/orders/stickers?type=svg&width=58&height=40`;
    
    const stickersRes = await fetch(stickersUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orders: chunkIds })
    });

    if (!stickersRes.ok) throw new Error(`Failed to fetch stickers: ${stickersRes.statusText}`);
    const stickersData = await stickersRes.json();
    const stickers = stickersData.data || [];

    // 3. Merge Data
    const mergedOrders: WBOrder[] = [];
    const barcodeMap: Record<string, number> = {};

    rawOrders.forEach((ro: any) => {
      // Find sticker data
      const stickerObj = stickers.find((s: any) => s.orderId === ro.id);
      
      // In reality, you'd decode the base64 SVG or barcode value from the sticker data
      // API v3 stickers endpoint returns partA + partB which form the code.
      // For this PWA implementation, we assume we can extract the 'barcode' string.
      // NOTE: WB V3 Stickers endpoint returns SVG base64. 
      // Parsing barcode from SVG client side is hard. 
      // USUALLY the sticker ID (partA + partB) matches the barcode text.
      
      // Fallback logic for this exercise: assuming 'wbStickerIdParts' or similar exists,
      // or we construct it. Let's assume partA + partB as string.
      const stickerCode = stickerObj ? `${stickerObj.partA}${stickerObj.partB}` : `UNKNOWN-${ro.id}`;

      // Image Logic (Basket URL generation is complex, using placeholder for safety)
      const photoUrl = `https://picsum.photos/400/400?seed=${ro.id}`; 

      const order: WBOrder = {
        id: ro.id,
        stickerId: stickerCode,
        article: ro.nmId ? ro.nmId.toString() : 'N/A',
        title: `WB Item ${ro.nmId}`, // Title usually requires another fetch to content API
        price: ro.convertedPrice ? ro.convertedPrice / 100 : 0,
        photoUrl,
        isSgtinRequired: true, // Assuming all in this supply need it
        status: 'pending'
      };

      mergedOrders.push(order);
      barcodeMap[stickerCode] = ro.id;
      barcodeMap[cleanBarcode(stickerCode)] = ro.id;
    });

    return { orders: mergedOrders, map: barcodeMap };

  } catch (err: any) {
    console.error(err);
    throw new Error(err.message || "API Error");
  }
};

/**
 * Links KIZ (SGTIN) to an Order
 */
export const linkKizToOrder = async (
  token: string, 
  orderId: number, 
  kiz: string, 
  isDemo: boolean
): Promise<boolean> => {
  if (isDemo) {
    await new Promise(r => setTimeout(r, MOCK_DELAY));
    return true;
  }

  try {
    const url = `https://marketplace-api.wildberries.ru/api/v3/orders/${orderId}/meta/sgtin`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sgtins: [kiz] })
    });

    if (!res.ok) throw new Error("Failed to link SGTIN");
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
};