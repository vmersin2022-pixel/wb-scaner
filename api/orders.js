export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { token, supplyId } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    const headers = {
      'Authorization': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // 1. Get Orders using the new endpoint (old supplies/{id}/orders is deprecated)
    const ordersUrl = `https://marketplace-api.wildberries.ru/api/v3/orders/new`;
    const ordersRes = await fetch(ordersUrl, { headers });

    if (!ordersRes.ok) {
      const errText = await ordersRes.text();
      return res.status(ordersRes.status).json({ error: `WB API Error (Orders): ${errText}` });
    }

    const ordersData = await ordersRes.json();
    let rawOrders = ordersData.orders || [];

    // Filter by supplyId if provided (Client side filtering since API doesn't support it in URL anymore)
    if (supplyId) {
      // Create a normalized version for comparison (trim whitespace, ignore case)
      const targetSupply = supplyId.trim();
      rawOrders = rawOrders.filter(o => o.supplyId === targetSupply);
    }

    if (rawOrders.length === 0) {
      return res.status(200).json({ 
        orders: [], 
        map: {},
        message: supplyId ? `No orders found for supply ${supplyId}` : 'No new orders found'
      });
    }

    // 2. Get Stickers (Chunked)
    const orderIds = rawOrders.map((o) => o.id);
    
    // Fetch stickers in chunks
    const chunks = [];
    for (let i = 0; i < orderIds.length; i += 100) {
      chunks.push(orderIds.slice(i, i + 100));
    }

    let allStickers = [];

    // Process chunks sequentially
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
    }

    // 3. Merge and Return
    const mergedOrders = [];
    const barcodeMap = {};

    rawOrders.forEach((ro) => {
      const stickerObj = allStickers.find((s) => s.orderId === ro.id);
      
      let stickerCode = '';
      if (stickerObj && stickerObj.partA && stickerObj.partB) {
        stickerCode = `${stickerObj.partA}${stickerObj.partB}`;
      } else {
        stickerCode = `UNKNOWN-${ro.id}`;
      }
      
      // Construct photo URL (standard WB logic)
      const vol = Math.floor(ro.nmId / 100000);
      const part = Math.floor(ro.nmId / 1000);
      const photoUrl = `https://basket-01.wb.ru/vol${vol}/part${part}/${ro.nmId}/images/c246x328/1.jpg`; 

      const order = {
        id: ro.id,
        stickerId: stickerCode,
        article: ro.nmId ? ro.nmId.toString() : 'N/A',
        title: `WB Item ${ro.nmId}`, 
        price: ro.convertedPrice ? ro.convertedPrice / 100 : 0,
        photoUrl,
        isSgtinRequired: true,
        status: 'pending' // You might check ro.status if available, but usually 'new' means pending
      };

      mergedOrders.push(order);
      // Map both exact and potential formats
      barcodeMap[stickerCode] = ro.id;
    });

    return res.status(200).json({ orders: mergedOrders, map: barcodeMap });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}