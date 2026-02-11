export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { token, orderId, kiz } = req.body;

  if (!token || !orderId || !kiz) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const url = `https://marketplace-api.wildberries.ru/api/v3/orders/${orderId}/meta/sgtin`;
    const wbRes = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json',
      },
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
}