export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { token, supplyId } = req.body;

  if (!token || !supplyId) {
    return res.status(400).json({ error: 'Missing token or supplyId' });
  }

  try {
    const headers = {
      'Authorization': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // 1. Get Orders
    const ordersUrl = `https://marketplace-api.wildberries.ru/api/v3/supplies/${supplyId}/orders`;
    const ordersRes = await fetch(ordersUrl, { headers });

    if (!ordersRes.ok) {
      const errText = await ordersRes.text();
      return res.status(ordersRes.status).json({ error: `WB API Error (Orders): ${errText}` });
    }

    const ordersData = await ordersRes.json();
    const rawOrders = ordersData.orders || [];

    if (rawOrders.length === 0) {
      return res.status(200).json({ orders: [], map: {} });
    }

    // 2. Get Stickers (Chunked)
    const orderIds = rawOrders.map((o) => o.id);
    
    // Fetch only first 100 for basic operation to fit strict timeouts/limits in MVP.
    // In production, you would loop through all chunks properly.
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
      
      const photoUrl = `https://basket-01.wb.ru/vol${Math.floor(ro.nmId / 100000)}/part${Math.floor(ro.nmId / 1000)}/${ro.nmId}/images/c246x328/1.jpg`; 

      const order = {
        id: ro.id,
        stickerId: stickerCode,
        article: ro.nmId ? ro.nmId.toString() : 'N/A',
        title: `WB Item ${ro.nmId}`, 
        price: ro.convertedPrice ? ro.convertedPrice / 100 : 0,
        photoUrl,
        isSgtinRequired: true,
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