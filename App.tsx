import React, { useState, useEffect, useRef } from 'react';
import { WBOrder, AppStep, SupplyStats } from './types';
import { fetchSupplyOrders, linkKizToOrder, cleanBarcode } from './services/wbService';
import { audioService } from './services/audioService';
import { ScannerInput } from './components/ScannerInput';
import { ScanOverlay } from './components/ScanOverlay';
import { Loader2, AlertCircle, PackageCheck, ImageOff } from 'lucide-react';

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
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Ошибка API");
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
        showFeedback('ERROR', 'Уже собран');
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

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-slate-900 p-4 flex flex-col items-center">
      <ScanOverlay status={overlayStatus} message={feedbackMsg} />
      
      <div className="w-full max-w-xl space-y-4">
        
        {/* Title */}
        <h1 className="text-2xl font-bold text-slate-900 mb-6">FBS-КИЗ сканер</h1>

        {/* Inputs Form */}
        <form onSubmit={handleLoadOrders} className="space-y-4">
          <input
            type="password"
            className="w-full p-3 border border-gray-200 rounded-lg bg-white outline-none focus:border-blue-500 transition-colors"
            placeholder="API токен WB"
            value={token}
            onChange={e => setToken(e.target.value)}
          />
          <input
            type="text"
            className="w-full p-3 border border-gray-200 rounded-lg bg-white outline-none focus:border-blue-500 transition-colors"
            placeholder="ID поставки (WB-GI-...)"
            value={supplyId}
            onChange={e => setSupplyId(e.target.value)}
          />
          
          {errorMsg && (
            <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center border border-red-100">
              <AlertCircle className="w-4 h-4 mr-2" />
              {errorMsg}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isLoading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : "Загрузить заказы"}
            </button>
            <button
              type="button"
              onClick={() => setIsDemo(!isDemo)}
              className="px-4 py-2 text-gray-400 text-sm hover:text-gray-600"
            >
              {isDemo ? 'Демо ВКЛ' : 'Демо'}
            </button>
          </div>
        </form>

        {/* Loaded Orders Interface */}
        {orders.length > 0 && (
          <div className="mt-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            
            {/* Stats */}
            <div className="flex items-center gap-2 mb-2">
              <PackageCheck className="w-5 h-5 text-green-600" />
              <span className="font-bold text-lg">Найдено заказов: {orders.length} шт.</span>
              {stats.done > 0 && (
                 <span className="ml-auto text-gray-500 font-medium">Собрано: {stats.done}</span>
              )}
            </div>

            {/* Active Task Info - LARGE PHOTO VIEW */}
            {activeOrder && (
              <div className="bg-white border-2 border-blue-500 shadow-lg p-4 rounded-xl flex flex-col items-center text-center gap-3 mb-4">
                 <div className="relative w-48 h-64 bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center">
                   {activeOrder.photoUrl ? (
                      <img 
                      src={activeOrder.photoUrl} 
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                      }}
                      className="w-full h-full object-cover" 
                      alt="Товар" 
                    />
                   ) : null}
                   
                   {/* Fallback image if loading fails */}
                   <div className={`absolute inset-0 flex flex-col items-center justify-center bg-gray-100 text-gray-400 ${activeOrder.photoUrl ? 'hidden' : ''}`}>
                      <ImageOff className="w-12 h-12 mb-2" />
                      <span className="text-xs">Нет фото</span>
                   </div>
                 </div>
                 
                 <div className="w-full">
                   <div className="text-sm font-bold text-blue-600 uppercase tracking-wider mb-1">Товар найден</div>
                   <h2 className="text-xl font-bold leading-tight mb-1">{activeOrder.title}</h2>
                   <div className="text-gray-500 text-sm">Арт: {activeOrder.article}</div>
                   {activeOrder.stickerId && (
                     <div className="text-xs text-gray-400 mt-1 font-mono">{activeOrder.stickerId}</div>
                   )}
                 </div>
              </div>
            )}

            {/* Main Scanner Input */}
            <ScannerInput 
              onScan={handleScan} 
              isDisabled={isLoading} 
              placeholder={activeOrder 
                ? ">>> 2. ТЕПЕРЬ СКАНИРУЙ КИЗ <<<" 
                : "1. Сканируй QR стикера WB"}
            />

          </div>
        )}

      </div>
    </div>
  );
};

export default App;