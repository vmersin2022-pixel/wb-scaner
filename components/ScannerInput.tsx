import React, { useEffect, useRef, useState } from 'react';
import { ScanBarcode, Camera, X, AlertCircle } from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface ScannerInputProps {
  onScan: (code: string) => void;
  isDisabled?: boolean;
  placeholder?: string;
  mode?: 'neutral' | 'active' | 'success';
}

export const ScannerInput: React.FC<ScannerInputProps> = ({ 
  onScan, 
  isDisabled, 
  placeholder,
  mode = 'neutral'
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [buffer, setBuffer] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- HARDWARE SCANNER LOGIC ---
  useEffect(() => {
    const focusInput = () => {
      if (!isDisabled && !showCamera && inputRef.current) {
        if (document.activeElement?.tagName !== 'INPUT' || document.activeElement === inputRef.current) {
           inputRef.current.focus({ preventScroll: true });
        }
      }
    };

    const interval = setInterval(focusInput, 1500);
    const handleClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'BUTTON' && target.tagName !== 'INPUT' && !showCamera) {
            focusInput();
        }
    }

    focusInput();
    window.addEventListener('click', handleClick);
    return () => {
      clearInterval(interval);
      window.removeEventListener('click', handleClick);
    };
  }, [isDisabled, showCamera]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setBuffer(val);
    if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    if (!val.trim()) return;

    submitTimerRef.current = setTimeout(() => {
        if (val.trim().length > 0) triggerScan(val.trim());
    }, 250);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
      if (buffer.trim().length > 0) triggerScan(buffer.trim());
    }
  };

  const triggerScan = (code: string) => {
    onScan(code);
    setBuffer('');
  };

  // --- CAMERA LOGIC (FIXED FOR iOS) ---
  useEffect(() => {
    if (!showCamera) {
      // Cleanup
      if (scannerRef.current) {
        scannerRef.current.stop().then(() => {
          scannerRef.current?.clear();
        }).catch(err => console.warn("Stop failed", err));
      }
      return;
    }

    const startScanner = async () => {
      setCameraError(null);
      
      // Delay to ensure DOM element #reader is rendered and has size
      await new Promise(r => setTimeout(r, 300));

      const scannerId = "reader";
      
      if (!document.getElementById(scannerId)) {
        setCameraError("Ошибка инициализации видео");
        return;
      }

      try {
        const formats = [ 
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.DATAMATRIX,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.QR_CODE
        ];

        scannerRef.current = new Html5Qrcode(scannerId);

        // Explicitly request back camera (environment)
        // This is crucial for iOS
        const config = { 
            fps: 10, 
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0 
        };

        await scannerRef.current.start(
            { facingMode: "environment" }, 
            config,
            (decodedText) => {
                console.log("Cam Scan:", decodedText);
                triggerScan(decodedText);
                setShowCamera(false);
            },
            (errorMessage) => {
                // Ignore parse errors, they happen every frame
            }
        );

      } catch (err: any) {
        console.error("Camera Start Error:", err);
        setCameraError("Нет доступа к камере. Разрешите доступ в настройках браузера.");
      }
    };

    startScanner();

    return () => {
       if (scannerRef.current) {
           try {
               if (scannerRef.current.isScanning) {
                   scannerRef.current.stop().catch(console.error);
               }
               scannerRef.current.clear();
           } catch (e) { console.error(e); }
       }
    };
  }, [showCamera]);


  const borderColor = mode === 'active' ? 'border-fuchsia-500' : 'border-gray-300';
  const ringColor = mode === 'active' ? 'ring-fuchsia-200' : 'ring-gray-100';
  const iconColor = mode === 'active' ? 'text-fuchsia-600' : 'text-gray-400';

  return (
    <div className="w-full mt-4 relative group">
      
      {/* Camera Modal */}
      {showCamera && (
         <div className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-center p-4 animate-in fade-in duration-200">
             <button 
                onClick={() => setShowCamera(false)}
                className="absolute top-4 right-4 bg-white/20 p-2 rounded-full text-white z-50 backdrop-blur-md active:scale-95 transition-transform"
             >
                <X className="w-8 h-8" />
             </button>
             
             <div className="w-full max-w-sm bg-black rounded-2xl overflow-hidden shadow-2xl relative ring-1 ring-white/20">
                 {/* The Library attaches video here */}
                 <div id="reader" className="w-full h-[350px] bg-gray-900"></div>

                 {/* Error State */}
                 {cameraError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gray-900/90 backdrop-blur-sm">
                       <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                       <p className="text-white text-lg font-medium">{cameraError}</p>
                       <button 
                          onClick={() => setShowCamera(false)}
                          className="mt-6 px-6 py-2 bg-white text-black font-bold rounded-lg"
                       >
                          Закрыть
                       </button>
                    </div>
                 )}
             </div>
             
             {!cameraError && (
                 <p className="text-white mt-6 text-center text-lg font-medium opacity-80 animate-pulse">
                    Наведите камеру на код
                 </p>
             )}
         </div>
      )}

      {/* Input UI */}
      <div className={`absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none ${iconColor} transition-colors duration-300`}>
        <ScanBarcode className={`w-6 h-6 ${mode === 'active' ? 'animate-pulse' : ''}`} />
      </div>
      
      <input
        ref={inputRef}
        type="text"
        value={buffer}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        autoComplete="off"
        disabled={isDisabled || showCamera}
        className={`w-full pl-12 pr-14 py-4 text-xl font-mono tracking-wide rounded-xl border-2 bg-white shadow-sm transition-all duration-300
          ${borderColor} 
          ${isFocused ? `ring-4 ${ringColor} ${mode === 'active' ? 'animate-glow' : ''}` : 'opacity-80'}
          focus:outline-none`}
        placeholder="" 
      />
      
      <div className={`absolute left-12 top-0 h-full flex items-center pointer-events-none transition-all duration-300 ${buffer ? 'opacity-0' : 'opacity-100'}`}>
        <span className={`text-lg ${mode === 'active' ? 'text-fuchsia-600 font-medium' : 'text-gray-400'}`}>
            {placeholder || "Сканировать..."}
        </span>
      </div>

      <div className="absolute inset-y-0 right-0 pr-2 flex items-center">
        <button 
           onClick={() => setShowCamera(true)}
           disabled={isDisabled}
           className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-lg transition-colors active:scale-95"
           title="Открыть камеру"
        >
           <Camera className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};