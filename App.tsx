import React, { useState, useEffect, useRef } from 'react';
import { WBOrder, AppStep, SupplyStats } from './types';
import { fetchSupplyOrders, linkKizToOrder, cleanBarcode } from './services/wbService';
import { audioService } from './services/audioService';
import { ScannerInput } from './components/ScannerInput';
import { ScanOverlay } from './components/ScanOverlay';
import { 
  Package, QrCode, LogOut, Loader2, 
  Scan, Zap, Box, ArrowRight, Barcode 
} from 'lucide-react';

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
    if (step !== AppStep.LOGIN) requestWakeLock();
    return () => {
      wakeLockRef.current?.release();
    };
  }, [step]);

  // --- Helpers ---

  const showFeedback = (type: 'SUCCESS' | 'ERROR', msg: string, duration = 1000) => {
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token && !isDemo) return setErrorMsg("Введите API Token");
    if (!supplyId && !isDemo) return setErrorMsg("Введите ID Поставки");

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const data = await fetchSupplyOrders(token, supplyId, isDemo);
      setOrders(data.orders);
      setOrderMap(data.map);
      setStep(AppStep.SCAN_ORDER);
    } catch (err: any) {
      setErrorMsg(err.message || "Ошибка загрузки");
    } finally {
      setIsLoading(false);
    }
  };

  const handleScan = async (rawCode: string) => {
    if (overlayStatus !== null || isLoading) return; 
    
    const code = cleanBarcode(rawCode);
    console.log("Scanned:", code, "Current Step:", step);

    // --- SCAN ORDER ---
    if (step === AppStep.SCAN_ORDER) {
      const orderId = orderMap[code];
      
      if (!orderId) {
        showFeedback('ERROR', 'Заказ не найден');
        return;
      }

      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      if (order.status === 'done') {
        showFeedback('ERROR', 'Уже собран');
        return;
      }

      setActiveOrder(order);
      setStep(AppStep.SCAN_KIZ);
      audioService.playScanSuccess();
      return;
    }

    // --- SCAN KIZ ---
    if (step === AppStep.SCAN_KIZ && activeOrder) {
      if (orderMap[code]) {
         showFeedback('ERROR', 'Это QR заказа!');
         return;
      }

      if (code.length < 10) {
        showFeedback('ERROR', 'Неверный формат КИЗ');
        return;
      }

      setIsLoading(true);
      const success = await linkKizToOrder(token, activeOrder.id, code, isDemo);
      setIsLoading(false);

      if (success) {
        setOrders(prev => prev.map(o => o.id === activeOrder.id ? { ...o, status: 'done', sgtin: code } : o));
        showFeedback('SUCCESS', 'Готово!');
      } else {
        showFeedback('ERROR', 'Ошибка API');
      }
    }
  };

  // --- RENDER: LOGIN ---

  if (step === AppStep.LOGIN) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-fuchsia-900 via-purple-900 to-indigo-900 flex flex-col justify-center items-center p-4 relative overflow-hidden">
        {/* Abstract Background Shapes */}
        <div className="absolute top-0 left-0 w-64 h-64 bg-fuchsia-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>
        <div className="absolute bottom-0 right-0 w-64 h-64 bg-indigo-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>

        <div className="glass w-full max-w-md p-8 rounded-3xl relative z-10">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-gradient-to-r from-fuchsia-600 to-purple-600 p-4 rounded-2xl shadow-lg mb-4 transform -rotate-3 hover:rotate-0 transition-transform">
              <Package className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">WB FBS Scanner</h1>
            <p className="text-slate-500 font-medium mt-1">SGTIN / Честный Знак</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-4">
              <div className="relative">
                <input
                  type="password"
                  className="w-full pl-4 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-fuchsia-500 focus:border-transparent outline-none transition-all placeholder-slate-400 font-medium"
                  placeholder="API Token (v3)"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                />
              </div>
              <div className="relative">
                <input
                  type="text"
                  className="w-full pl-4 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-fuchsia-500 focus:border-transparent outline-none transition-all placeholder-slate-400 font-medium"
                  placeholder="ID Поставки (WB-GI-...)"
                  value={supplyId}
                  onChange={e => setSupplyId(e.target.value)}
                />
              </div>
            </div>

            <button 
              type="button" 
              onClick={() => setIsDemo(!isDemo)}
              className={`w-full py-2 px-4 rounded-lg border text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 ${isDemo ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
            >
              {isDemo ? <Zap className="w-4 h-4 fill-current" /> : <Box className="w-4 h-4" />}
              {isDemo ? 'Demo Mode Active' : 'Demo Mode Off'}
            </button>

            {errorMsg && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-red-600 text-sm font-medium flex items-center animate-shake">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 mr-2" />
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 bg-gradient-to-r from-fuchsia-600 to-purple-700 hover:from-fuchsia-500 hover:to-purple-600 text-white font-bold text-lg rounded-xl transition-all shadow-lg hover:shadow-fuchsia-500/30 disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center"
            >
              {isLoading ? <Loader2 className="animate-spin w-6 h-6" /> : "Загрузить Заказы"}
            </button>
          </form>
        </div>
        
        <div className="mt-8 text-white/40 text-xs font-mono">v1.0.0 • Made for Warehouse</div>
      </div>
    );
  }

  // --- RENDER: MAIN APP ---
  
  const stats = getStats();
  const progress = stats.total > 0 ? (stats.done / stats.total) * 100 : 0;
  const isAllDone = stats.done === stats.total && stats.total > 0;

  return (
    <div className="flex flex-col h-screen bg-slate-100 font-sans">
      <ScannerInput onScan={handleScan} isDisabled={overlayStatus !== null} />
      <ScanOverlay status={overlayStatus} message={feedbackMsg} />

      {/* HEADER */}
      <header className="bg-white shadow-sm z-20 pb-4">
        <div className="bg-gradient-to-r from-wb-brand to-purple-700 text-white px-4 py-3 flex justify-between items-center">
           <div className="flex items-center gap-3">
             <div className="bg-white/20 p-1.5 rounded-lg">
               <Package className="w-5 h-5 text-white" />
             </div>
             <div className="leading-none">
               <div className="text-[10px] opacity-80 font-bold tracking-wider uppercase">Поставка</div>
               <div className="font-mono font-bold text-sm truncate max-w-[150px]">{isDemo ? 'DEMO-123' : supplyId}</div>
             </div>
           </div>
           <button 
             onClick={() => setStep(AppStep.LOGIN)} 
             className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
           >
             <LogOut className="w-5 h-5 text-white" />
           </button>
        </div>
        
        {/* Progress Card */}
        <div className="px-4 -mb-8 relative z-10">
          <div className="bg-white rounded-xl shadow-lg border border-slate-100 p-4 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Прогресс</span>
              <span className="text-2xl font-black text-slate-800">
                {stats.done} <span className="text-slate-300">/</span> {stats.total}
              </span>
            </div>
            <div className="w-16 h-16 relative flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90">
                <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-slate-100" />
                <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="6" fill="transparent" strokeDasharray={175} strokeDashoffset={175 - (175 * progress) / 100} className={`text-wb-brand transition-all duration-1000 ease-out ${isAllDone ? 'text-green-500' : ''}`} />
              </svg>
              <div className="absolute font-bold text-xs text-slate-600">{Math.round(progress)}%</div>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 px-4 pt-10 pb-4 overflow-y-auto flex flex-col items-center justify-center max-w-lg mx-auto w-full">
        
        {isAllDone ? (
          <div className="text-center p-8 bg-white rounded-3xl shadow-xl border border-green-100">
            <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Package className="w-12 h-12 text-green-600" />
            </div>
            <h2 className="text-3xl font-black text-slate-800 mb-2">Все собрано!</h2>
            <p className="text-slate-500">Поставка полностью укомплектована.</p>
          </div>
        ) : step === AppStep.SCAN_ORDER ? (
          // --- STEP 1: SCAN ORDER ---
          <div className="w-full flex flex-col items-center animate-in fade-in zoom-in duration-300">
            <div className="relative w-64 h-64 mb-8">
              {/* Animated Scanner Frame */}
              <div className="absolute inset-0 border-4 border-slate-200 rounded-3xl"></div>
              <div className="absolute inset-0 border-4 border-wb-brand rounded-3xl opacity-20 animate-pulse"></div>
              
              {/* Corners */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-wb-brand rounded-tl-3xl"></div>
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-wb-brand rounded-tr-3xl"></div>
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-wb-brand rounded-bl-3xl"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-wb-brand rounded-br-3xl"></div>

              {/* Scan Line */}
              <div className="absolute top-4 left-4 right-4 h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_15px_rgba(239,68,68,0.8)] animate-scan-line z-10"></div>

              <div className="absolute inset-0 flex items-center justify-center">
                 <QrCode className="w-24 h-24 text-slate-300" />
              </div>
            </div>

            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-bold uppercase tracking-wider mb-2">
                <Scan className="w-3 h-3" /> Шаг 1
              </div>
              <h2 className="text-3xl font-black text-slate-800">Сканируй заказ</h2>
              <p className="text-slate-500 font-medium">Наведи сканер на QR стикера WB</p>
            </div>
          </div>

        ) : activeOrder && (
          // --- STEP 2: SCAN KIZ ---
          <div className="w-full flex flex-col animate-in slide-in-from-right duration-300">
            
            <div className="bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-slate-100">
              {/* Product Header */}
              <div className="bg-state-kiz p-4 text-white text-center relative overflow-hidden">
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="relative z-10 flex items-center justify-center gap-2 font-bold uppercase tracking-widest text-sm">
                   <Barcode className="w-4 h-4" /> Сканируй КИЗ
                </div>
              </div>

              <div className="p-6">
                <div className="flex gap-5 mb-6">
                  <div className="w-1/3 aspect-[3/4] relative rounded-xl overflow-hidden shadow-md bg-gray-100 flex-shrink-0">
                     <img 
                       src={activeOrder.photoUrl} 
                       alt="Product" 
                       className="w-full h-full object-cover"
                       onError={(e) => { (e.target as HTMLImageElement).src = 'https://via.placeholder.com/150?text=No+Img' }}
                     />
                  </div>
                  <div className="flex-1 flex flex-col">
                    <div className="flex-1">
                      <h3 className="font-bold text-slate-800 text-lg leading-snug line-clamp-3 mb-2">
                        {activeOrder.title}
                      </h3>
                      <div className="inline-block px-2 py-1 bg-slate-100 rounded text-xs font-mono text-slate-500">
                        {activeOrder.article}
                      </div>
                    </div>
                    <div>
                       <div className="text-xs text-slate-400 font-bold uppercase">Цена</div>
                       <div className="text-2xl font-black text-wb-brand">{activeOrder.price} ₽</div>
                    </div>
                  </div>
                </div>

                {/* Interaction Zone */}
                <div className="bg-purple-50 rounded-2xl p-6 border-2 border-dashed border-purple-200 flex flex-col items-center text-center">
                   <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-3">
                     <div className="grid grid-cols-2 gap-0.5">
                       <div className="w-2 h-2 bg-purple-600"></div><div className="w-2 h-2 bg-purple-600"></div>
                       <div className="w-2 h-2 bg-purple-600"></div><div className="w-2 h-2 bg-transparent"></div>
                     </div>
                   </div>
                   <p className="text-purple-900 font-bold text-lg">Жду DataMatrix</p>
                   <p className="text-purple-600/70 text-sm mt-1">Ищи квадратный код на упаковке</p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-center">
               <button 
                 onClick={() => {
                   setStep(AppStep.SCAN_ORDER);
                   setActiveOrder(null);
                 }}
                 className="text-slate-400 text-sm font-medium hover:text-slate-600 flex items-center gap-2 py-2 px-4"
               >
                 Отмена <ArrowRight className="w-4 h-4" />
               </button>
            </div>
          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-100 p-3">
        <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
           <div className="flex items-center gap-1.5">
             <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-amber-400 animate-ping' : 'bg-green-400'}`}></div>
             {isLoading ? 'Обработка...' : 'Система готова'}
           </div>
           <div>Mode: {isDemo ? 'SIMULATION' : 'LIVE API'}</div>
        </div>
      </footer>

    </div>
  );
};

export default App;