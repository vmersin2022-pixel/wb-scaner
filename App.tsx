import React, { useState, useEffect, useRef, useMemo } from 'react';
import { WBOrder, AppStep, SupplyStats } from './types';
import { fetchSupplyOrders, linkKizToOrder, cleanBarcode } from './services/wbService';
import { audioService } from './services/audioService';
import { ScannerInput } from './components/ScannerInput';
import { ScanOverlay } from './components/ScanOverlay';
import { ProductImage } from './components/ProductImage';
import { Loader2, PackageCheck, QrCode, Zap, X, ScanBarcode, List as ListIcon, CheckCircle2, LayoutGrid, Box } from 'lucide-react';

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
      
      if (orderMap[code]) {
         const newOrderId = orderMap[code];
         if (newOrderId !== activeOrder.id) {
             const newOrder = orders.find(o => o.id === newOrderId);
             if (newOrder && newOrder.status !== 'done') {
                 setActiveOrder(newOrder);
                 audioService.playScanSuccess();
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
      const success = await linkKizToOrder(token, activeOrder.id, code, isDemo);
      
      if (success) {
        setOrders(prev => prev.map(o => o.id === activeOrder.id ? { ...o, status: 'done', sgtin: code } : o));
        setStep(AppStep.SCAN_ORDER);
        setActiveOrder(null);
        showFeedback('SUCCESS', 'ПРИВЯЗАНО!');
      } else {
        showFeedback('ERROR', 'ОШИБКА ИЛИ ДУБЛЬ');
      }
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoading && scanQueue.length > 0) {
      const nextCode = scanQueue[0];
      setScanQueue(prev => prev.slice(1));
      processScan(nextCode);
    }
  }, [isLoading, scanQueue]);

  const handleScanInput = (code: string) => {
    if (!isLoading) {
      processScan(code);
    } else {
      setScanQueue(prev => [...prev, code]);
    }
  };

  const stats = getStats();
  const progressPercent = stats.total > 0 ? (stats.done / stats.total) * 100 : 0;

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-gray-50 text-slate-900 font-sans">
      <ScanOverlay status={overlayStatus} message={feedbackMsg} />
      
      {/* --- LOGIN SCREEN (Centered, clean) --- */}
      {orders.length === 0 && (
        <div className="min-h-screen flex flex-col justify-center items-center p-6">
           <div className="bg-white p-10 rounded-3xl shadow-2xl w-full max-w-md border border-gray-100 relative">
              {(token || supplyId) && (
                <button 
                  onClick={clearCredentials}
                  className="absolute top-4 right-4 text-gray-300 hover:text-red-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
              <div className="flex flex-col items-center mb-8">
                 <div className="w-20 h-20 bg-fuchsia-600 rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-fuchsia-200">
                    <QrCode className="text-white w-10 h-10" />
                 </div>
                 <h1 className="text-3xl font-bold text-gray-900">FBS Склад</h1>
                 <p className="text-gray-400 mt-2">Версия для ПК</p>
              </div>
              <form onSubmit={handleLoadOrders} className="space-y-4">
                <input
                    type="password"
                    className="w-full mt-1 p-4 bg-gray-50 border border-gray-200 rounded-xl focus:border-fuchsia-500 transition-all outline-none text-lg"
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    placeholder="API Token (WB)"
                  />
                  <input
                    type="text"
                    className="w-full mt-1 p-4 bg-gray-50 border border-gray-200 rounded-xl focus:border-fuchsia-500 transition-all outline-none text-lg"
                    value={supplyId}
                    onChange={e => setSupplyId(e.target.value)}
                    placeholder="Поставка (WB-GI-...)"
                  />
                {errorMsg && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm flex items-center border border-red-100">{errorMsg}</div>}
                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-4 bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold rounded-xl shadow-lg transition-all active:scale-[0.98] flex justify-center items-center text-lg"
                  >
                    {isLoading ? <Loader2 className="animate-spin w-6 h-6" /> : "Загрузить базу"}
                  </button>
                  <button type="button" onClick={() => setIsDemo(!isDemo)} className="w-full text-xs text-center text-gray-400 py-2 hover:text-gray-600">
                    {isDemo ? 'ДЕМО РЕЖИМ' : 'Включить демо'}
                  </button>
              </form>
           </div>
        </div>
      )}

      {/* --- DESKTOP WORKSPACE --- */}
      {orders.length > 0 && (
        <div className="w-full h-screen flex flex-col overflow-hidden">
          
          {/* Header Bar */}
          <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between shadow-sm z-20 shrink-0">
             <div className="flex items-center gap-6">
                <div>
                   <h2 className="text-2xl font-black text-gray-900 tracking-tight">Поставка</h2>
                   <div className="text-sm text-gray-400 font-mono">{supplyId}</div>
                </div>
                {/* Desktop Tabs */}
                <div className="flex bg-gray-100 p-1 rounded-lg">
                   <button 
                      onClick={() => setActiveTab('SCANNER')}
                      className={`px-6 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'SCANNER' ? 'bg-white shadow text-fuchsia-700' : 'text-gray-500 hover:text-gray-700'}`}
                   >
                      <ScanBarcode className="inline w-4 h-4 mr-2"/> Сканер
                   </button>
                   <button 
                      onClick={() => setActiveTab('LIST')}
                      className={`px-6 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'LIST' ? 'bg-white shadow text-fuchsia-700' : 'text-gray-500 hover:text-gray-700'}`}
                   >
                      <ListIcon className="inline w-4 h-4 mr-2"/> Список товаров
                   </button>
                </div>
             </div>

             <div className="flex items-center gap-8">
                <div className="w-64">
                   <div className="flex justify-between text-sm font-bold mb-1">
                      <span className="text-gray-500">Прогресс</span>
                      <span className="text-fuchsia-600">{stats.done} / {stats.total}</span>
                   </div>
                   <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-fuchsia-500 transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
                   </div>
                </div>
                <button onClick={clearCredentials} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500">
                   <X className="w-6 h-6" />
                </button>
             </div>
          </header>

          {/* Main Content Area */}
          <main className="flex-1 overflow-hidden relative bg-gray-50 p-6">
            
            {activeTab === 'SCANNER' && (
               <div className="max-w-[1920px] mx-auto h-full flex flex-col gap-6">
                  
                  {!activeOrder ? (
                     // IDLE STATE
                     <div className="flex-1 bg-white rounded-3xl border-4 border-dashed border-gray-200 flex flex-col items-center justify-center">
                        <PackageCheck className="w-32 h-32 text-gray-200 mb-8" />
                        <h3 className="text-4xl font-bold text-gray-300">Сканируйте стикер WB</h3>
                        <div className="w-full max-w-xl mt-12">
                            <ScannerInput 
                                onScan={handleScanInput} 
                                isDisabled={false} 
                                mode="neutral"
                                placeholder="Ожидание сканирования..."
                            />
                        </div>
                     </div>
                  ) : (
                     // ACTIVE STATE (Two Columns)
                     <div className="h-full grid grid-cols-1 lg:grid-cols-12 gap-6">
                        
                        {/* LEFT: MASSIVE IMAGE (8 Cols) */}
                        <div className="lg:col-span-8 bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden relative flex items-center justify-center p-8">
                           <div className="absolute top-4 left-4 z-10 bg-fuchsia-600 text-white px-4 py-2 rounded-full font-bold uppercase tracking-wider text-sm flex items-center gap-2 shadow-lg">
                              <Zap className="w-4 h-4 fill-white animate-pulse" /> Товар найден
                           </div>
                           <ProductImage 
                              src={activeOrder.photoUrl} 
                              alt="Товар" 
                              className="w-full h-full max-h-[80vh]" // Limit height so it doesn't overflow container
                           />
                        </div>

                        {/* RIGHT: INFO PANEL (4 Cols) */}
                        <div className="lg:col-span-4 flex flex-col gap-4 h-full">
                           <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200 flex-1 flex flex-col justify-center text-center lg:text-left">
                              
                              <div className="mb-8">
                                 <div className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Бренд</div>
                                 <div className="text-2xl font-bold text-gray-700">{activeOrder.brand}</div>
                              </div>

                              <div className="mb-10">
                                 <div className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Артикул</div>
                                 <div className="text-5xl lg:text-6xl font-black text-gray-900 tracking-tight break-words leading-none">
                                    {activeOrder.vendorCode}
                                 </div>
                              </div>

                              <div className="mb-auto">
                                 <div className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Размер</div>
                                 <div className="inline-block bg-gray-100 text-gray-900 text-7xl lg:text-8xl font-black px-8 py-4 rounded-2xl border-2 border-gray-200">
                                    {activeOrder.size || '-'}
                                 </div>
                              </div>
                              
                              <div className="mt-8 pt-8 border-t border-gray-100">
                                 <div className="text-xs font-bold text-gray-400 uppercase mb-1">Баркод стикера</div>
                                 <div className="text-xl font-mono text-gray-600"><BarcodeDisplay code={activeOrder.stickerId} /></div>
                              </div>
                           </div>

                           {/* INPUT BOX */}
                           <div className="bg-fuchsia-50 rounded-2xl p-4 border-2 border-fuchsia-100 shadow-lg">
                              <div className="text-fuchsia-800 font-bold mb-2 uppercase text-sm ml-1">Сканируйте КИЗ</div>
                              <ScannerInput 
                                 onScan={handleScanInput} 
                                 isDisabled={false} 
                                 mode="active"
                                 placeholder="КИЗ (Data Matrix)..."
                              />
                           </div>
                        </div>
                     </div>
                  )}
               </div>
            )}

            {activeTab === 'LIST' && (
               <div className="max-w-7xl mx-auto bg-white rounded-3xl shadow-sm border border-gray-200 h-full overflow-hidden flex flex-col">
                  {/* List Controls */}
                  <div className="p-4 border-b border-gray-100 bg-gray-50 flex gap-4">
                     <button onClick={() => setListMode('PRINTS')} className={`px-6 py-2 rounded-lg font-bold text-sm ${listMode === 'PRINTS' ? 'bg-white shadow text-fuchsia-700' : 'text-gray-500'}`}>По принтам</button>
                     <button onClick={() => setListMode('SIZES')} className={`px-6 py-2 rounded-lg font-bold text-sm ${listMode === 'SIZES' ? 'bg-white shadow text-fuchsia-700' : 'text-gray-500'}`}>По размерам</button>
                     <button onClick={() => setListMode('ITEMS')} className={`px-6 py-2 rounded-lg font-bold text-sm ${listMode === 'ITEMS' ? 'bg-white shadow text-fuchsia-700' : 'text-gray-500'}`}>Все товары</button>
                     
                     <div className="ml-auto">
                        <input 
                           type="text" 
                           placeholder="Поиск..." 
                           className="px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:border-fuchsia-500 w-64"
                           value={listSearch}
                           onChange={e => setListSearch(e.target.value)}
                        />
                     </div>
                  </div>

                  {/* List Content */}
                  <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
                     {listMode === 'PRINTS' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                           {statsByPrint.map((group: any) => (
                              <div key={group.vendorCode} className="bg-white rounded-xl p-4 shadow-sm border border-gray-200 flex gap-4 hover:shadow-md transition-shadow">
                                 <div className="w-24 h-32 bg-gray-100 rounded-lg overflow-hidden shrink-0">
                                    <ProductImage src={group.photoUrl} alt="" className="w-full h-full" />
                                 </div>
                                 <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-2">
                                       <div className="font-bold text-lg text-gray-900 truncate pr-2">{group.vendorCode}</div>
                                       <span className="bg-fuchsia-100 text-fuchsia-700 font-bold px-3 py-1 rounded-lg">{group.total}</span>
                                    </div>
                                    <div className="text-sm text-gray-500 mb-3">{group.title}</div>
                                    <div className="flex flex-wrap gap-2">
                                       {Object.entries(group.sizes).map(([s, c]: any) => (
                                          <span key={s} className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold border border-gray-200">
                                             {s}: <span className="text-gray-900">{c}</span>
                                          </span>
                                       ))}
                                    </div>
                                 </div>
                              </div>
                           ))}
                        </div>
                     )}

                     {listMode === 'SIZES' && (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                           {statsBySize.map(([size, count]) => (
                              <div key={size} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center justify-center text-center aspect-square">
                                 <div className="text-6xl font-black text-gray-900 mb-2">{count}</div>
                                 <div className="text-lg font-bold text-gray-500 bg-gray-100 px-4 py-1 rounded-full">{size}</div>
                              </div>
                           ))}
                        </div>
                     )}

                     {listMode === 'ITEMS' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                           {filteredItems.map(item => (
                               <div key={item.id} className={`bg-white rounded-xl p-4 shadow-sm border border-gray-200 flex gap-4 ${item.status === 'done' ? 'opacity-60 grayscale' : ''}`}>
                                   <div className="w-20 h-28 bg-gray-100 rounded-lg shrink-0 relative overflow-hidden">
                                       <ProductImage src={item.photoUrl} alt="" className="w-full h-full" />
                                       {item.status === 'done' && <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center"><CheckCircle2 className="text-green-600 w-8 h-8"/></div>}
                                   </div>
                                   <div className="flex-1 min-w-0 flex flex-col justify-center">
                                       <div className="font-bold text-gray-900 truncate mb-1">{item.vendorCode}</div>
                                       <div className="text-xs text-gray-500 mb-2 truncate">{item.title}</div>
                                       <div className="mt-auto flex items-center justify-between">
                                           <span className="bg-gray-100 px-2 py-1 rounded font-bold text-sm">{item.size}</span>
                                           <span className="font-mono text-xs text-gray-400">{item.stickerId}</span>
                                       </div>
                                   </div>
                               </div>
                           ))}
                        </div>
                     )}
                  </div>
               </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
};

export default App;