import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WBOrder, AppStep, SupplyStats } from './types';
import { fetchSupplyOrders, linkKizToOrder, cleanBarcode } from './services/wbService';
import { audioService } from './services/audioService';
import { ScannerInput } from './components/ScannerInput';
import { ScanOverlay } from './components/ScanOverlay';
import { Settings, Package, QrCode, LogOut, CheckCircle, Barcode, WifiOff, Loader2 } from 'lucide-react';

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
  
  // Request Wake Lock on mount (if supported)
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

  const showFeedback = (type: 'SUCCESS' | 'ERROR', msg: string, duration = 1500) => {
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
        // Reset to waiting for next order
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
    if (!token && !isDemo) return setErrorMsg("API Token Required");
    if (!supplyId && !isDemo) return setErrorMsg("Supply ID Required");

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const data = await fetchSupplyOrders(token, supplyId, isDemo);
      setOrders(data.orders);
      setOrderMap(data.map);
      setStep(AppStep.SCAN_ORDER);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to load supply");
    } finally {
      setIsLoading(false);
    }
  };

  const handleScan = async (rawCode: string) => {
    if (overlayStatus !== null || isLoading) return; // Block input during feedback or loading
    
    const code = cleanBarcode(rawCode);
    console.log("Scanned:", code, "Current Step:", step);

    // --- LOGIC: WAITING FOR ORDER (QR) ---
    if (step === AppStep.SCAN_ORDER) {
      const orderId = orderMap[code];
      
      if (!orderId) {
        showFeedback('ERROR', 'Order Not Found');
        return;
      }

      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      if (order.status === 'done') {
        showFeedback('ERROR', 'Already Packed');
        return;
      }

      // Found valid order
      setActiveOrder(order);
      setStep(AppStep.SCAN_KIZ);
      audioService.playScanSuccess();
      return;
    }

    // --- LOGIC: WAITING FOR KIZ (DataMatrix) ---
    if (step === AppStep.SCAN_KIZ && activeOrder) {
      // Validation 1: Prevent scanning the WB QR again
      if (orderMap[code]) {
         showFeedback('ERROR', 'Scan KIZ, not WB Sticker');
         return;
      }

      // Validation 2: KIZ Length (DataMatrix usually long)
      if (code.length < 10) {
        showFeedback('ERROR', 'Invalid KIZ Format');
        return;
      }

      // Perform Link
      setIsLoading(true);
      const success = await linkKizToOrder(token, activeOrder.id, code, isDemo);
      setIsLoading(false);

      if (success) {
        // Update local state
        setOrders(prev => prev.map(o => o.id === activeOrder.id ? { ...o, status: 'done', sgtin: code } : o));
        showFeedback('SUCCESS', 'Linked Successfully', 1000);
        // Step reset happens in showFeedback timeout
      } else {
        showFeedback('ERROR', 'API Link Failed');
      }
    }
  };

  // --- Renderers ---

  if (step === AppStep.LOGIN) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
          <div className="flex justify-center mb-6">
            <div className="bg-wb-brand p-4 rounded-full">
              <Package className="w-10 h-10 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center text-wb-dark mb-2">WB FBS Scanner</h1>
          <p className="text-gray-500 text-center mb-8">Link Honest Sign (KIZ) to Orders</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">API Token</label>
              <input
                type="password"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-wb-brand focus:border-wb-brand outline-none transition-all"
                placeholder="Paste v3 API token"
                value={token}
                onChange={e => setToken(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supply ID</label>
              <input
                type="text"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-wb-brand focus:border-wb-brand outline-none transition-all"
                placeholder="WB-GI-xxxxxxx"
                value={supplyId}
                onChange={e => setSupplyId(e.target.value)}
              />
            </div>

            <div className="flex items-center space-x-3 py-2">
              <button 
                type="button" 
                onClick={() => setIsDemo(!isDemo)}
                className={`flex-1 py-2 px-4 rounded border text-sm font-medium transition-colors ${isDemo ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-gray-100 border-gray-300 text-gray-600'}`}
              >
                Demo Mode: {isDemo ? 'ON' : 'OFF'}
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 rounded bg-red-50 text-red-600 text-sm flex items-center">
                <WifiOff className="w-4 h-4 mr-2" />
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 bg-wb-brand hover:bg-fuchsia-700 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-xl disabled:opacity-70 flex justify-center items-center"
            >
              {isLoading ? <Loader2 className="animate-spin w-6 h-6" /> : "Load Orders"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Work Stats
  const stats = getStats();
  const progress = stats.total > 0 ? (stats.done / stats.total) * 100 : 0;

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <ScannerInput onScan={handleScan} isDisabled={overlayStatus !== null} />
      <ScanOverlay status={overlayStatus} message={feedbackMsg} />

      {/* Header */}
      <header className="bg-white shadow-sm border-b px-4 py-3 z-10">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-wb-dark text-lg">
              {stats.done} / {stats.total}
            </span>
            <span className="text-xs px-2 py-0.5 bg-gray-200 rounded text-gray-600 font-mono">
              {isDemo ? 'DEMO' : supplyId}
            </span>
          </div>
          <button onClick={() => setStep(AppStep.LOGIN)} className="text-gray-400 hover:text-red-500">
            <LogOut className="w-6 h-6" />
          </button>
        </div>
        {/* Progress Bar */}
        <div className="h-3 w-full bg-gray-200 rounded-full overflow-hidden">
          <div 
            className="h-full bg-green-500 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col p-4 overflow-y-auto">
        
        {step === AppStep.SCAN_ORDER && (
          <div className="flex-1 flex flex-col justify-center items-center text-center space-y-6 animate-pulse-fast border-4 border-dashed border-state-idle rounded-3xl p-6 bg-blue-50">
            <div className="bg-white p-6 rounded-full shadow-lg">
               <QrCode className="w-24 h-24 text-state-idle" />
            </div>
            <div>
              <h2 className="text-3xl font-extrabold text-blue-900 mb-2">SCAN ORDER</h2>
              <p className="text-blue-600 text-lg">Scan the WB Sticker QR Code</p>
            </div>
            <div className="mt-8 opacity-50 text-sm">
              Keyboard input active
            </div>
          </div>
        )}

        {step === AppStep.SCAN_KIZ && activeOrder && (
          <div className="flex-1 flex flex-col border-4 border-solid border-state-kiz rounded-3xl overflow-hidden shadow-2xl bg-white relative">
            
            {/* Top Badge */}
            <div className="bg-state-kiz text-white text-center py-2 font-bold tracking-widest uppercase">
              Scan Honest Sign (KIZ)
            </div>

            <div className="flex-1 flex flex-col p-6">
              {/* Product Info */}
              <div className="flex space-x-4 mb-6">
                 <img 
                    src={activeOrder.photoUrl} 
                    alt="Product" 
                    className="w-32 h-40 object-cover rounded-lg shadow-md bg-gray-200"
                  />
                 <div className="flex-1 flex flex-col justify-between py-1">
                    <div>
                      <h3 className="font-bold text-gray-900 leading-tight mb-1 line-clamp-3 text-lg">
                        {activeOrder.title}
                      </h3>
                      <p className="text-sm text-gray-500">Art: {activeOrder.article}</p>
                    </div>
                    <div className="text-2xl font-bold text-wb-brand">
                      {activeOrder.price} ₽
                    </div>
                 </div>
              </div>

              <div className="flex-1 flex flex-col justify-center items-center text-center space-y-4">
                 <Barcode className="w-32 h-32 text-state-kiz opacity-80" />
                 <p className="text-purple-900 font-medium text-xl animate-pulse">
                   Waiting for DataMatrix...
                 </p>
              </div>
            </div>

            {/* Warning / Hint */}
            <div className="bg-purple-50 p-4 border-t border-purple-100 text-center text-purple-800 text-sm">
               Check the code length. Do not scan WB QR again.
            </div>
          </div>
        )}

      </main>

      {/* Footer / Status Bar */}
      <footer className="bg-white border-t p-3 text-center text-xs text-gray-400">
        Status: {isLoading ? 'Processing...' : 'Ready'} | Mode: {isDemo ? 'Simulation' : 'Live'}
      </footer>

    </div>
  );
};

export default App;