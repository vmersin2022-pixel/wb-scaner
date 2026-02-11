import React, { useState, useEffect, useRef } from 'react';
import { WBOrder, AppStep, SupplyStats } from './types';
import { fetchSupplyOrders, linkKizToOrder, cleanBarcode } from './services/wbService';
import { audioService } from './services/audioService';
import { ScannerInput } from './components/ScannerInput';
import { ScanOverlay } from './components/ScanOverlay';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

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
      setErrorMsg(err.message || "Ошибка загрузки");
    } finally {
      setIsLoading(false);
    }
  };

  const handleScan = async (rawCode: string) => {
    if (overlayStatus !== null || isLoading) return; 
    
    const code = cleanBarcode(rawCode);
    console.log("Scanned:", code);

    // Логика сброса (если нужно начать сначала или отменить)
    if (code.toLowerCase() === 'reset' || code.toLowerCase() === 'сброс') {
      setActiveOrder(null);
      setStep(AppStep.SCAN_ORDER);
      return;
    }

    // --- SCAN ORDER ---
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

    // --- SCAN KIZ ---
    if (step === AppStep.SCAN_KIZ && activeOrder) {
      // Защита от повторного сканирования того же QR заказа
      if (orderMap[code]) {
         showFeedback('ERROR', 'Это QR заказа! Нужен КИЗ.');
         return;
      }

      if (code.length < 5) { // Простая валидация
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
    <div className="min-h-screen bg-gray-50 text-slate-800 font-sans p-4">
      <ScanOverlay status={overlayStatus} message={feedbackMsg} />
      
      <div className="max-w-2xl mx-auto space-y-6">
        
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">FBS-КИЗ сканер</h1>
          <p className="text-sm text-slate-500">Версия 1.1 • {isDemo ? 'Демо режим' : 'Live API'}</p>
        </div>

        {/* Configuration Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
           <form onSubmit={handleLoadOrders} className="space-y-4">
              <div>
                <input
                  type="password"
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder-gray-400"
                  placeholder="API токен WB"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                />
              </div>
              
              <div>
                <input
                  type="text"
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder-gray-400"
                  placeholder="ID поставки (WB-GI-...)"
                  value={supplyId}
                  onChange={e => setSupplyId(e.target.value)}
                />
              </div>

              {errorMsg && (
                <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  {errorMsg}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition-colors flex justify-center items-center"
                >
                  {isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : "Загрузить заказы"}
                </button>
                
                <button
                  type="button"
                  onClick={() => setIsDemo(!isDemo)}
                  className="px-4 py-3 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium text-sm"
                >
                  {isDemo ? 'Выкл Демо' : 'Демо'}
                </button>
              </div>
           </form>
        </div>

        {/* Stats & Scanner Area (Visible only when orders loaded) */}
        {orders.length > 0 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Stats Bar */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between">
               <div>
                 <div className="text-sm text-gray-500 font-medium">Найдено в поставке</div>
                 <div className="text-2xl font-bold text-slate-900">{orders.length} шт.</div>
               </div>
               <div className="text-right">
                 <div className="text-sm text-gray-500 font-medium">Собрано</div>
                 <div className={`text-2xl font-bold ${stats.done === stats.total ? 'text-green-600' : 'text-blue-600'}`}>
                   {stats.done} <span className="text-gray-300 text-lg">/</span> {stats.total}
                 </div>
               </div>
            </div>

            {/* Active Task Card */}
            {activeOrder ? (
               <div className="bg-blue-50 border-2 border-blue-200 p-6 rounded-xl flex gap-4 items-start">
                  <div className="w-20 h-24 bg-white rounded-lg shadow-sm overflow-hidden flex-shrink-0">
                    <img src={activeOrder.photoUrl} className="w-full h-full object-cover" alt="" />
                  </div>
                  <div className="flex-1">
                    <div className="inline-block px-2 py-0.5 bg-blue-600 text-white text-xs font-bold rounded mb-2">ШАГ 2: СКАНИРУЙ КИЗ</div>
                    <h3 className="font-bold text-slate-800 leading-tight mb-1">{activeOrder.title}</h3>
                    <p className="text-sm text-slate-500 mb-2">{activeOrder.article}</p>
                    <p className="text-lg font-bold text-slate-900">{activeOrder.price} ₽</p>
                  </div>
               </div>
            ) : (
               <div className="bg-white border-2 border-dashed border-gray-300 p-6 rounded-xl text-center text-gray-500">
                  <CheckCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  <p>Ожидание сканирования стикера WB...</p>
               </div>
            )}

            {/* Main Scanner Input */}
            <ScannerInput 
              onScan={handleScan} 
              isDisabled={isLoading} 
              placeholder={
                activeOrder 
                ? ">>> СКАНИРУЙ КИЗ (DataMatrix) <<<" 
                : "1. Сканируй QR стикера WB..."
              }
            />

            {/* Instruction Text */}
            <div className="text-center text-gray-400 text-sm">
              {activeOrder 
                ? "Найдите квадратный код DataMatrix на упаковке товара" 
                : "Возьмите товар и отсканируйте QR-код на этикетке Wildberries"}
            </div>

          </div>
        )}

      </div>
    </div>
  );
};

export default App;