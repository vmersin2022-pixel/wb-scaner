import React, { useState, useEffect, useRef, useMemo } from 'react';
import { WBOrder, AppStep, SupplyStats } from './types';
import { fetchSupplyOrders, linkKizToOrder, cleanBarcode } from './services/wbService';
import { audioService } from './services/audioService';
import { ScannerInput } from './components/ScannerInput';
import { ScanOverlay } from './components/ScanOverlay';
import { ProductImage } from './components/ProductImage';
import { Loader2, PackageCheck, QrCode, Zap, X, ScanBarcode, List as ListIcon, CheckCircle2 } from 'lucide-react';

// Helper to highlight barcode end
const BarcodeDisplay = ({ code }: { code: string }) => {
  if (!code) return <span>-</span>;
  const len = code.length;
  if (len <= 4) return <span className="font-mono">{code}</span>;
  const head = code.slice(0, len - 4);
  const tail = code.slice(len - 4);
  return (
    <span className="font-mono text-gray-500">
      {head}<span className="text-gray-900 font-black text-lg">{tail}</span>
    </span>
  );
};

const App: React.FC = () => {
  // --- State ---
  const [token, setToken] = useState('');
  const [supplyId, setSupplyId] = useState('');
  const [isDemo, setIsDemo] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [step, setStep] = useState<AppStep>(AppStep.LOGIN);
  const [orders, setOrders] = useState<WBOrder[]>([]);
  const [orderMap, setOrderMap] = useState<Record<string, number>>({});
  const [activeOrder, setActiveOrder] = useState<WBOrder | null>(null);
  
  const [activeTab, setActiveTab] = useState<'SCANNER' | 'LIST'>('SCANNER');
  const [listMode, setListMode] = useState<'PRINTS' | 'SIZES' | 'ITEMS'>('PRINTS');
  const [listSearch, setListSearch] = useState('');

  const [overlayStatus, setOverlayStatus] = useState<'SUCCESS' | 'ERROR' | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // --- Scan Queue for Fast Input ---
  const [scanQueue, setScanQueue] = useState<string[]>([]);

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const savedToken = localStorage.getItem('wb_token');
    const savedSupplyId = localStorage.getItem('wb_supply_id');
    if (savedToken) setToken(savedToken);
    if (savedSupplyId) setSupplyId(savedSupplyId);

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        }
      } catch (err) { console.warn('Wake Lock failed', err); }
    };
    requestWakeLock();
    return () => { wakeLockRef.current?.release(); };
  }, []);

  const showFeedback = (type: 'SUCCESS' | 'ERROR', msg: string, duration = 1200) => {
    setOverlayStatus(type);
    setFeedbackMsg(msg);
    if (type === 'SUCCESS') {
      if (step === AppStep.SCAN_KIZ) audioService.playTaskComplete();
      else audioService.playScanSuccess();
    } else {
      audioService.playError();
    }

    // Auto-clear overlay
    setTimeout(() => {
      setOverlayStatus(null);
      setFeedbackMsg('');
    }, duration);
  };

  const getStats = (): SupplyStats => {
    return {
      total: orders.length,
      done: orders.filter(o => o.status === 'done').length
    };
  };

  const clearCredentials = () => {
    localStorage.removeItem('wb_token');
    localStorage.removeItem('wb_supply_id');
    setToken('');
    setSupplyId('');
  };

  // --- Aggregation Logic ---
  const statsByPrint = useMemo(() => {
    const groups: Record<string, any> = {};
    orders.forEach(order => {
        const vCode = order.vendorCode || 'Без артикула';
        if (!groups[vCode]) {
            groups[vCode] = {
                vendorCode: vCode,
                photoUrl: order.photoUrl,
                title: order.title,
                brand: order.brand || '',
                total: 0,
                sizes: {}
            };
        }
        groups[vCode].total += 1;
        const s = order.size || '-';
        groups[vCode].sizes[s] = (groups[vCode].sizes[s] || 0) + 1;
    });
    return Object.values(groups).sort((a: any, b: any) => b.total - a.total);
  }, [orders]);

  const statsBySize = useMemo(() => {
      const sizes: Record<string, number> = {};
      orders.forEach(order => {
          const s = order.size || 'Б/Р';
          sizes[s] = (sizes[s] || 0) + 1;
      });
      return Object.entries(sizes).sort((a, b) => b[1] - a[1]);
  }, [orders]);

  const filteredItems = useMemo(() => {
    if (!listSearch) return orders;
    const q = listSearch.toLowerCase();
    return orders.filter(o => 
       o.vendorCode.toLowerCase().includes(q) || 
       o.stickerId.includes(q) ||
       o.size?.toLowerCase().includes(q)
    );
  }, [orders, listSearch]);


  // --- Handlers ---
  const handleLoadOrders = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token && !isDemo) return setErrorMsg("Введите API Token");
    
    // Clear previous state immediately to avoid showing old data if this load fails
    setOrders([]);
    setOrderMap({});
    setActiveOrder(null);
    
    if (!isDemo) {
        localStorage.setItem('wb_token', token);
        localStorage.setItem('wb_supply_id', supplyId);
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const data = await fetchSupplyOrders(token, supplyId, isDemo);
      if (data.orders.length === 0) {
        setErrorMsg("Заказы не найдены");
      } else {
        setOrders(data.orders);
        setOrderMap(data.map);
        setStep(AppStep.SCAN_ORDER);
        audioService.playScanSuccess();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Ошибка API");
      audioService.playError();
    } finally {
      setIsLoading(false);
    }
  };

  // --- SCAN PROCESSING LOGIC ---
  const processScan = async (rawCode: string) => {
    const code = cleanBarcode(rawCode);
    console.log("Processing:", code);

    if (code.toLowerCase() === 'reset' || code.toLowerCase() === 'сброс') {
      setActiveOrder(null);
      setStep(AppStep.SCAN_ORDER);
      return;
    }

    // --- STEP 1: SCAN ORDER ---
    if (step === AppStep.SCAN_ORDER) {
      const orderId = orderMap[code];
      
      if (!orderId) {
        // Проверка: может это КИЗ?
        if (code.length > 20) {
            showFeedback('ERROR', 'Сначала стикер WB!');
        } else {
            showFeedback('ERROR', 'Неизвестный QR');
        }
        return;
      }

      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      if (order.status === 'done') {
        showFeedback('ERROR', 'УЖЕ СОБРАН!');
        return;
      }

      setActiveOrder(order);
      setStep(AppStep.SCAN_KIZ);
      setActiveTab('SCANNER');
      audioService.playScanSuccess();
      return;
    }

    // --- STEP 2: SCAN KIZ ---
    if (step === AppStep.SCAN_KIZ && activeOrder) {
      
      // Auto-Switch: If user scans a WB Sticker instead of KIZ, check if they are switching orders
      if (orderMap[code]) {
         const newOrderId = orderMap[code];
         if (newOrderId !== activeOrder.id) {
             // Switching to different order
             const newOrder = orders.find(o => o.id === newOrderId);
             if (newOrder && newOrder.status !== 'done') {
                 setActiveOrder(newOrder);
                 audioService.playScanSuccess();
                 // Stay in SCAN_KIZ but for new order
                 return; 
             } else if (newOrder && newOrder.status === 'done') {
                 showFeedback('ERROR', 'УЖЕ СОБРАН!');
                 setStep(AppStep.SCAN_ORDER);
                 setActiveOrder(null);
                 return;
             }
         } else {
             showFeedback('ERROR', 'Нужен КИЗ (DataMatrix)!');
             return;
         }
      }

      if (code.length < 5) {
        showFeedback('ERROR', 'Короткий код');
        return;
      }

      setIsLoading(true);
      // Pass isDemo logic
      const success = await linkKizToOrder(token, activeOrder.id, code, isDemo);
      
      if (success) {
        // Optimistic update
        setOrders(prev => prev.map(o => o.id === activeOrder.id ? { ...o, status: 'done', sgtin: code } : o));
        
        // IMMEDIATE STATE RESET for continuous workflow
        setStep(AppStep.SCAN_ORDER);
        setActiveOrder(null);

        showFeedback('SUCCESS', 'ПРИВЯЗАНО!');
      } else {
        // Keep activeOrder so they can try again or check error
        showFeedback('ERROR', 'ОШИБКА ИЛИ ДУБЛЬ');
      }
      setIsLoading(false);
    }
  };

  // Queue Processor
  useEffect(() => {
    if (!isLoading && scanQueue.length > 0) {
      const nextCode = scanQueue[0];
      setScanQueue(prev => prev.slice(1));
      processScan(nextCode);
    }
  }, [isLoading, scanQueue]);

  // Main Handler (adds to queue)
  const handleScanInput = (code: string) => {
    // If idle, process immediately. If busy, queue it.
    if (!isLoading) {
      processScan(code);
    } else {
      setScanQueue(prev => [...prev, code]);
    }
  };

  const stats = getStats();
  const progressPercent = stats.total > 0 ? (stats.done / stats.total) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-slate-900 flex flex-col items-center relative overflow-hidden">
      <ScanOverlay status={overlayStatus} message={feedbackMsg} />
      
      {/* --- LOGIN SCREEN --- */}
      {orders.length === 0 && (
        <div className="flex-1 flex flex-col justify-center items-center w-full max-w-md p-6">
           <div className="bg-white p-8 rounded-3xl shadow-xl w-full border border-gray-100 relative">
              {(token || supplyId) && (
                <button 
                  onClick={clearCredentials}
                  className="absolute top-4 right-4 text-gray-300 hover:text-red-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
              <div className="flex flex-col items-center mb-8">
                 <div className="w-16 h-16 bg-fuchsia-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-fuchsia-200">
                    <QrCode className="text-white w-8 h-8" />
                 </div>
                 <h1 className="text-3xl font-bold text-gray-900">FBS Склад 2.0</h1>
              </div>
              <form onSubmit={handleLoadOrders} className="space-y-4">
                <input
                    type="password"
                    className="w-full mt-1 p-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-fuchsia-500 transition-all outline-none"
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    placeholder="API Token (WB)"
                  />
                  <input
                    type="text"
                    className="w-full mt-1 p-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-fuchsia-500 transition-all outline-none"
                    value={supplyId}
                    onChange={e => setSupplyId(e.target.value)}
                    placeholder="Поставка (WB-GI-...)"
                  />
                {errorMsg && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm flex items-center border border-red-100">{errorMsg}</div>}
                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3.5 bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold rounded-xl shadow-lg transition-all active:scale-[0.98] flex justify-center items-center"
                  >
                    {isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : "Загрузить базу"}
                  </button>
                  <button type="button" onClick={() => setIsDemo(!isDemo)} className="w-full text-xs text-center text-gray-400 py-2">
                    {isDemo ? 'ДЕМО' : 'Включить демо'}
                  </button>
              </form>
           </div>
        </div>
      )}

      {/* --- WORKSPACE --- */}
      {orders.length > 0 && (
        <div className="w-full max-w-lg flex flex-col h-screen relative">
          
          {/* Header */}
          <div className="bg-white px-6 py-4 shadow-sm z-10 sticky top-0">
            <div className="flex justify-between items-end mb-2">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">Поставка</h2>
                <div className="text-xs text-gray-400 font-mono">{supplyId}</div>
              </div>
              <div className="text-right">
                <span className="text-3xl font-black text-fuchsia-600">{stats.done}</span>
                <span className="text-gray-400 font-medium text-lg"> / {stats.total}</span>
              </div>
            </div>
            <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden">
               <div className="h-full bg-fuchsia-500 transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pb-24 bg-gray-50">
            {activeTab === 'SCANNER' && (
               <div className="p-4 flex flex-col gap-4 h-full">
                  {!activeOrder ? (
                     <div className="flex-1 flex flex-col items-center justify-center text-center bg-white rounded-3xl border-2 border-dashed border-gray-300 p-8 min-h-[300px]">
                        <PackageCheck className="w-16 h-16 text-gray-300 mb-6" />
                        <h3 className="text-2xl font-bold text-gray-400">Сканируйте<br/>стикер WB</h3>
                     </div>
                  ) : (
                     <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-fuchsia-100 flex-1 flex flex-col">
                        <div className="bg-fuchsia-600 text-white text-center py-2 font-bold text-sm tracking-widest uppercase flex items-center justify-center gap-2">
                           <Zap className="w-4 h-4 fill-white animate-bounce" /> НАЙДЕН
                        </div>
                        <div className="relative h-64 bg-gray-100 flex items-center justify-center overflow-hidden">
                           <ProductImage 
                              src={activeOrder.photoUrl} 
                              alt="Товар" 
                              className="w-full h-full"
                           />
                           {activeOrder.size && (
                              <div className="absolute top-4 right-4 bg-white/90 backdrop-blur text-gray-900 font-black text-2xl px-4 py-2 rounded-lg shadow-lg border border-gray-100">
                                 {activeOrder.size}
                              </div>
                           )}
                        </div>
                        <div className="p-6 flex-1 flex flex-col justify-center">
                           <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{activeOrder.brand}</div>
                           <h2 className="text-4xl font-black leading-none mb-4 text-gray-900 break-words tracking-tight">
                              {activeOrder.vendorCode}
                           </h2>
                           <div className="flex items-center gap-4 mt-auto pt-4 border-t border-gray-100">
                              <div className="ml-auto text-right">
                                 <div className="text-[10px] uppercase text-gray-400 font-bold">Баркод</div>
                                 <BarcodeDisplay code={activeOrder.stickerId} />
                              </div>
                           </div>
                        </div>
                     </div>
                  )}

                  <div className="bg-white/80 backdrop-blur rounded-2xl p-2 sticky bottom-0">
                     <ScannerInput 
                        onScan={handleScanInput} 
                        isDisabled={false} 
                        mode={activeOrder ? 'active' : 'neutral'}
                        placeholder={activeOrder ? "СКАНИРУЙТЕ КИЗ" : "Жду стикер WB..."}
                     />
                  </div>
               </div>
            )}

            {activeTab === 'LIST' && (
               <div className="p-4 flex flex-col gap-3 min-h-full">
                  <div className="flex p-1 bg-gray-200/80 rounded-xl mb-2">
                     <button onClick={() => setListMode('PRINTS')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg ${listMode === 'PRINTS' ? 'bg-white shadow text-fuchsia-700' : 'text-gray-500'}`}>Принты</button>
                     <button onClick={() => setListMode('SIZES')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg ${listMode === 'SIZES' ? 'bg-white shadow text-fuchsia-700' : 'text-gray-500'}`}>Размеры</button>
                     <button onClick={() => setListMode('ITEMS')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg ${listMode === 'ITEMS' ? 'bg-white shadow text-fuchsia-700' : 'text-gray-500'}`}>Список</button>
                  </div>
                  {listMode === 'PRINTS' && (
                     <div className="space-y-3">
                        {statsByPrint.map((group: any) => (
                           <div key={group.vendorCode} className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 flex gap-3">
                              <div className="w-16 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                                 <ProductImage src={group.photoUrl} alt="" className="w-full h-full" />
                              </div>
                              <div className="flex-1">
                                 <div className="flex justify-between">
                                    <div className="font-bold text-gray-900">{group.vendorCode}</div>
                                    <div className="bg-fuchsia-50 text-fuchsia-700 font-bold px-2 rounded">{group.total}</div>
                                 </div>
                                 <div className="mt-2 flex flex-wrap gap-1">
                                    {Object.entries(group.sizes).map(([s, c]: any) => (
                                       <div key={s} className="bg-gray-100 text-xs px-1.5 py-0.5 rounded text-gray-600">{s}: <b>{c}</b></div>
                                    ))}
                                 </div>
                              </div>
                           </div>
                        ))}
                     </div>
                  )}
                  {listMode === 'SIZES' && (
                     <div className="grid grid-cols-2 gap-3">
                        {statsBySize.map(([size, count]) => (
                           <div key={size} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
                              <div className="text-4xl font-black text-gray-900 mb-1">{count}</div>
                              <div className="text-sm font-bold text-gray-400 bg-gray-100 px-3 py-1 rounded-full">{size}</div>
                           </div>
                        ))}
                     </div>
                  )}
                  {listMode === 'ITEMS' && (
                     <div className="space-y-3">
                        {filteredItems.map(item => (
                            <div key={item.id} className={`bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex gap-3 ${item.status === 'done' ? 'opacity-60 grayscale' : ''}`}>
                                <div className="w-12 h-16 bg-gray-100 rounded flex-shrink-0 relative overflow-hidden">
                                    <ProductImage src={item.photoUrl} alt="" className="w-full h-full" />
                                    {item.status === 'done' && <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center"><CheckCircle2 className="text-green-600"/></div>}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm truncate">{item.vendorCode}</div>
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <span className="bg-gray-100 px-1 rounded font-bold">{item.size}</span>
                                        <span className="font-mono">{item.stickerId}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                     </div>
                  )}
               </div>
            )}
          </div>
          <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex pb-safe">
             <button onClick={() => setActiveTab('SCANNER')} className={`flex-1 py-4 flex flex-col items-center ${activeTab === 'SCANNER' ? 'text-fuchsia-600' : 'text-gray-400'}`}>
                <ScanBarcode /> <span className="text-[10px] font-bold">СКАНЕР</span>
             </button>
             <button onClick={() => setActiveTab('LIST')} className={`flex-1 py-4 flex flex-col items-center ${activeTab === 'LIST' ? 'text-fuchsia-600' : 'text-gray-400'}`}>
                <ListIcon /> <span className="text-[10px] font-bold">СПИСОК</span>
             </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;