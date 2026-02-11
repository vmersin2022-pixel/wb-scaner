import { WBOrder } from '../types';

const MOCK_DELAY = 500;
const randId = () => Math.floor(Math.random() * 1000000000).toString();

export const cleanBarcode = (code: string): string => {
  return code.replace(/^\*+|\*+$/g, '').trim();
};

export const demoOrders: WBOrder[] = Array.from({ length: 15 }).map((_, i) => ({
  id: parseInt(randId()),
  stickerId: `WB-${Math.floor(Math.random() * 1000)}`,
  article: `ART-${1000 + i}`, // WB Article (nmId) mock
  vendorCode: `VENDOR-CODE-2025-${i + 1}`, // Vendor Article mock
  title: `Wildberries Product Test Item ${i + 1}`,
  brand: `Brand #${i + 1}`,
  price: Math.floor(Math.random() * 5000) + 500,
  photoUrl: `https://picsum.photos/400/500?random=${i}`,
  isSgtinRequired: true,
  status: 'pending'
}));

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
      map[cleanBarcode(o.stickerId)] = o.id; 
    });
    return { orders: [...demoOrders], map };
  }

  // Use local Vercel API proxy
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, supplyId })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Error ${res.status}: Failed to fetch orders`);
    }

    const data = await res.json();
    
    // Enhance map with cleaned barcodes for usability
    const enhancedMap = { ...data.map };
    Object.keys(data.map).forEach(key => {
      enhancedMap[cleanBarcode(key)] = data.map[key];
    });

    return { orders: data.orders, map: enhancedMap };

  } catch (err: any) {
    console.error(err);
    throw new Error(err.message || "API Connection Error");
  }
};

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
    const res = await fetch('/api/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, orderId, kiz })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Bind Error:", errText);
      return false;
    }
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
};