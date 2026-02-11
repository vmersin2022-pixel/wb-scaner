import React, { useState, useEffect, useRef } from 'react';
import { WBOrder, AppStep, SupplyStats } from './types';
import { fetchSupplyOrders, linkKizToOrder, cleanBarcode } from './services/wbService';
import { audioService } from './services/audioService';
import { ScannerInput } from './components/ScannerInput';
import { ScanOverlay } from './components/ScanOverlay';
import { Loader2, AlertCircle, PackageCheck, ImageOff, Box, QrCode, Zap } from 'lucide-react';

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
  
  // Feedback State
  const [overlayStatus, setOverlayStatus] = useState<'SUCCESS' | 'ERROR' | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // Wake Lock Ref
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // --- Effects ---
  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        }
      } catch (err) {
        console.warn('Wake Lock failed', err);
      }
    };
    requestWakeLock();
    return () => { wakeLockRef.current?.release(); };
  }, []);

  // --- Helpers ---
  const showFeedback = (type: 'SUCCESS' | 'ERROR', msg: string, duration = 1200) => {
    setOverlayStatus(type);
    setFeedbackMsg(msg);
    if (type === 'SUCCESS') {
      if (step === AppStep.SCAN_KIZ) audioService.playTaskComplete();
      else audioService.playScanSuccess();
    } else {
      audioService.playError();
    }

    setTimeout(() => {
      setOverlayStatus(null);
      setFeedbackMsg('');
      if (type === 'SUCCESS' && step === AppStep.SCAN_KIZ) {
        setStep(AppStep.SCAN_ORDER);
        setActiveOrder(null);
      }
    }, duration);
  };

  const getStats = (): SupplyStats => {
    return {
      total: orders.length,
      done: orders.filter(o => o.status === 'done').length
    };
  };

  // --- Handlers ---
  const handleLoadOrders = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token && !isDemo) return setErrorMsg("Введите API Token");
    
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const data = await fetchSupplyOrders(token, supplyId, isDemo);
      
      if (data.orders.length === 0) {
        setErrorMsg("Заказы не найдены. Проверьте ID поставки.");
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

  const handleScan = async (rawCode: string) => {
    if (overlayStatus !== null || isLoading) return; 
    
    const code = cleanBarcode(rawCode);
    console.log("Scanned:", code);

    // Сброс
    if (code.toLowerCase() === 'reset' || code.toLowerCase() === 'сброс') {
      setActiveOrder(null);
      setStep(AppStep.SCAN_ORDER);
      return;
    }

    // --- STEP 1: SCAN ORDER ---
    if (step === AppStep.SCAN_ORDER) {
      const orderId = orderMap[code];
      
      if (!orderId) {
        showFeedback('ERROR', 'Неизвестный QR');
        return;
      }

      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      if (order.status === 'done') {
        showFeedback('ERROR', 'Уже собран!');
        return;
      }

      setActiveOrder(order);
      setStep(AppStep.SCAN_KIZ);
      audioService.playScanSuccess();
      return;
    }

    // --- STEP 2: SCAN KIZ ---
    if (step === AppStep.SCAN_KIZ && activeOrder) {
      if (orderMap[code]) {
         showFeedback('ERROR', 'Это QR заказа! Нужен КИЗ.');
         return;
      }

      if (code.length < 5) {
        showFeedback('ERROR', 'Короткий код');
        return;
      }

      setIsLoading(true);
      const success = await linkKizToOrder(token, activeOrder.id, code, isDemo);
      setIsLoading(false);

      if (success) {
        setOrders(prev => prev.map(o => o.id === activeOrder.id ? { ...o, status: 'done', sgtin: code } : o));
        showFeedback('SUCCESS', 'Привязано!');
      } else {
        showFeedback('ERROR', 'Ошибка API WB');
      }
    }
  };

  const stats = getStats();
  const progressPercent = stats.total > 0 ? (stats.done / stats.total) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-slate-900 flex flex-col items-center relative overflow-hidden">
      <ScanOverlay status={overlayStatus} message={feedbackMsg} />
      
      {/* --- LOGIN SCREEN --- */}
      {orders.length === 0 && (
        <div className="flex-1 flex flex-col justify-center items-center w-full max-w-md p-6 animate-slide-up">
           <div className="bg-white p-8 rounded-3xl shadow-xl w-full border border-gray-100">
              <div className="flex flex-col items-center mb-8">
                 <div className="w-16 h-16 bg-fuchsia-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-fuchsia-200">
                    <QrCode className="text-white w-8 h-8" />
                 </div>
                 <h1 className="text-3xl font-bold text-gray-900">FBS Сканер</h1>
                 <p className="text-gray-500 text-sm mt-1">Подключение к складу</p>
              </div>

              <form onSubmit={handleLoadOrders} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider ml-1">API Токен</label>
                  <input
                    type="password"
                    className="w-full mt-1 p-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-200 transition-all outline-none font-mono text-sm"
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    placeholder="eyJhbGciOi..."
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider ml-1">ID Поставки</label>
                  <input
                    type="text"
                    className="w-full mt-1 p-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-200 transition-all outline-none font-mono text-sm"
                    value={supplyId}
                    onChange={e => setSupplyId(e.target.value)}
                    placeholder="WB-GI-12345678"
                  />
                </div>
                
                {errorMsg && (
                  <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm flex items-center border border-red-100 animate-pulse">
                    <AlertCircle className="w-4 h-4 mr-2" />
                    {errorMsg}
                  </div>
                )}

                <div className="pt-2 flex flex-col gap-3">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3.5 bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold rounded-xl shadow-lg shadow-fuchsia-200 transition-all active:scale-[0.98] flex justify-center items-center"
                  >
                    {isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : "Начать приемку"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDemo(!isDemo)}
                    className={`text-xs text-center py-2 rounded-lg transition-colors ${isDemo ? 'text-fuchsia-600 bg-fuchsia-50 font-bold' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    {isDemo ? 'РЕЖИМ ДЕМО: ВКЛЮЧЕН' : 'Включить демо режим'}
                  </button>
                </div>
              </form>
           </div>
        </div>
      )}

      {/* --- WORKSPACE SCREEN --- */}
      {orders.length > 0 && (
        <div className="w-full max-w-lg flex flex-col h-screen">
          
          {/* Header & Stats */}
          <div className="bg-white px-6 py-4 shadow-sm z-10 sticky top-0">
            <div className="flex justify-between items-end mb-2">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900 tracking-tight">Поставка</h2>
                <div className="text-xs text-gray-400 font-mono">{supplyId}</div>
              </div>
              <div className="text-right">
                <span className="text-3xl font-black text-fuchsia-600">{stats.done}</span>
                <span className="text-gray-400 font-medium text-lg"> / {stats.total}</span>
              </div>
            </div>
            {/* Progress Bar */}
            <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden">
               <div 
                 className="h-full bg-fuchsia-500 transition-all duration-500 ease-out progress-stripes"
                 style={{ width: `${progressPercent}%` }}
               />
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto pb-4">
            
            {/* Step 1: Scan Order Placeholder (Only when no active order) */}
            {!activeOrder && (
               <div className="flex-1 flex flex-col items-center justify-center text-center animate-slide-up bg-white rounded-3xl border-2 border-dashed border-gray-300 p-8 min-h-[300px]">
                  <div className="w-32 h-32 bg-gray-50 rounded-full flex items-center justify-center mb-6 animate-pulse">
                     <PackageCheck className="w-16 h-16 text-gray-300" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-400">Жду сканирования<br/>стикера WB</h3>
                  <p className="text-gray-400 text-sm mt-2">Наведите сканер на штрихкод товара</p>
               </div>
            )}

            {/* Step 2: Active Order Card */}
            {activeOrder && (
              <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-fuchsia-100 animate-slide-up flex-1 flex flex-col">
                 {/* Status Bar */}
                 <div className="bg-fuchsia-600 text-white text-center py-2 font-bold text-sm tracking-widest uppercase flex items-center justify-center gap-2">
                    <Zap className="w-4 h-4 fill-white animate-bounce" />
                    Товар найден
                 </div>
                 
                 {/* Image Area */}
                 <div className="relative h-64 bg-gray-100 flex items-center justify-center overflow-hidden group">
                   {activeOrder.photoUrl ? (
                      <img 
                      src={activeOrder.photoUrl} 
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                      }}
                      className="w-full h-full object-contain mix-blend-multiply p-2 transition-transform duration-500 group-hover:scale-105" 
                      alt="Товар" 
                    />
                   ) : null}
                   <div className={`absolute inset-0 flex flex-col items-center justify-center bg-gray-100 text-gray-400 ${activeOrder.photoUrl ? 'hidden' : ''}`}>
                      <ImageOff className="w-12 h-12 mb-2 opacity-50" />
                      <span className="text-xs">Фото недоступно</span>
                   </div>
                 </div>

                 {/* Details */}
                 <div className="p-6 flex-1 flex flex-col justify-center">
                    {/* Brand and Title (Secondary) */}
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex flex-wrap gap-1">
                       <span>{activeOrder.brand || "Бренд"}</span>
                       <span>•</span>
                       <span className="line-clamp-1 text-gray-500">{activeOrder.title}</span>
                    </div>

                    {/* VENDOR CODE (Main) */}
                    <h2 className="text-4xl font-black leading-none mb-4 text-gray-900 break-words tracking-tight">
                       {activeOrder.vendorCode || "Без Артикула"}
                    </h2>
                    
                    <div className="flex items-center gap-4 mt-auto pt-4 border-t border-gray-100">
                       <div>
                          <div className="text-[10px] uppercase text-gray-400 font-bold">Артикул WB</div>
                          <div className="font-mono text-lg font-medium">{activeOrder.article}</div>
                       </div>
                       <div className="ml-auto text-right">
                          <div className="text-[10px] uppercase text-gray-400 font-bold">Баркод</div>
                          <div className="font-mono text-sm text-gray-500">{activeOrder.stickerId}</div>
                       </div>
                    </div>
                 </div>
              </div>
            )}

            {/* Input Area (Sticky Bottom) */}
            <div className="bg-white/80 backdrop-blur rounded-2xl p-2 sticky bottom-0">
               <ScannerInput 
                 onScan={handleScan} 
                 isDisabled={isLoading} 
                 mode={activeOrder ? 'active' : 'neutral'}
                 placeholder={activeOrder 
                   ? "СКАНИРУЙТЕ КИЗ (DataMatrix)" 
                   : "Сканируйте стикер WB..."}
               />
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default App;
