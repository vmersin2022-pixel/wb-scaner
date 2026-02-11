import React, { useEffect, useRef, useState } from 'react';
import { ScanBarcode, Camera, X, AlertCircle } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

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
  const isProcessingRef = useRef(false); 
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- HARDWARE SCANNER LOGIC (Inputs) ---
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

  // --- CAMERA LOGIC (FULLSCREEN) ---
  
  const stopScanner = async () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
          try {
              await scannerRef.current.stop();
              scannerRef.current.clear();
          } catch (err) {
              console.warn("Error stopping scanner:", err);
          }
      }
  };

  const handleCloseCamera = async () => {
      await stopScanner();
      setShowCamera(false);
  };

  useEffect(() => {
    if (!showCamera) return;

    const startScanner = async () => {
      setCameraError(null);
      isProcessingRef.current = false;
      
      await new Promise(r => setTimeout(r, 100)); // UI delay

      const scannerId = "reader";
      if (!document.getElementById(scannerId)) return;

      try {
        if (scannerRef.current) {
            try { await scannerRef.current.clear(); } catch(e){}
        }

        scannerRef.current = new Html5Qrcode(scannerId);

        // Config for Fullscreen Mobile Scanning
        const config = { 
            fps: 15, 
            qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
                // Maximize scanning area (85% of smaller screen dimension)
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                return {
                    width: Math.floor(minEdge * 0.85),
                    height: Math.floor(minEdge * 0.85)
                };
            },
            aspectRatio: window.innerHeight / window.innerWidth
        };

        await scannerRef.current.start(
            { facingMode: "environment" }, 
            config,
            async (decodedText) => {
                if (isProcessingRef.current) return;
                isProcessingRef.current = true;
                
                console.log("Cam Scan:", decodedText);
                
                // CRITICAL: Stop camera BEFORE updating state to prevent freeze
                await stopScanner();
                setShowCamera(false);
                triggerScan(decodedText);
            },
            (errorMessage) => { /* ignore per-frame errors */ }
        );

      } catch (err: any) {
        console.error("Camera Start Error:", err);
        setCameraError("Ошибка доступа к камере. Проверьте разрешения.");
      }
    };

    startScanner();

    return () => {
        if (scannerRef.current && scannerRef.current.isScanning) {
             scannerRef.current.stop().catch(() => {});
        }
    };
  }, [showCamera]);


  const borderColor = mode === 'active' ? 'border-fuchsia-500' : 'border-gray-300';
  const ringColor = mode === 'active' ? 'ring-fuchsia-200' : 'ring-gray-100';
  const iconColor = mode === 'active' ? 'text-fuchsia-600' : 'text-gray-400';

  return (
    <div className="w-full mt-4 relative group">
      
      {/* FULLSCREEN OVERLAY */}
      {showCamera && (
         <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
             
             {/* Header */}
             <div className="absolute top-0 left-0 right-0 p-4 pt-safe z-50 flex justify-end">
                 <button 
                    onClick={handleCloseCamera}
                    className="bg-black/40 backdrop-blur-md p-3 rounded-full text-white/90 active:bg-white/20 transition-all"
                 >
                    <X className="w-8 h-8" />
                 </button>
             </div>

             {/* Viewport */}
             <div className="flex-1 relative w-full h-full bg-black overflow-hidden">
                 <div id="reader" className="w-full h-full [&>video]:object-cover [&>video]:w-full [&>video]:h-full"></div>
                 
                 {/* Guides */}
                 {!cameraError && (
                    <div className="absolute inset-0 border-[40px] border-black/60 pointer-events-none flex items-center justify-center box-border">
                        <div className="w-full h-full border-2 border-fuchsia-500/80 relative rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                            <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-fuchsia-500 rounded-tl-xl"></div>
                            <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-fuchsia-500 rounded-tr-xl"></div>
                            <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-fuchsia-500 rounded-bl-xl"></div>
                            <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-fuchsia-500 rounded-br-xl"></div>
                        </div>
                    </div>
                 )}

                 {/* Error Msg */}
                 {cameraError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-gray-900 z-50">
                       <AlertCircle className="w-16 h-16 text-red-500 mb-6" />
                       <p className="text-white text-lg font-medium mb-8 opacity-90">{cameraError}</p>
                       <button 
                          onClick={handleCloseCamera}
                          className="px-8 py-3 bg-white text-black font-bold rounded-xl active:scale-95"
                       >
                          Закрыть
                       </button>
                    </div>
                 )}
             </div>

             {/* Footer Text */}
             {!cameraError && (
                 <div className="absolute bottom-0 left-0 right-0 p-8 pb-16 bg-gradient-to-t from-black/90 to-transparent z-50 text-center pointer-events-none">
                    <p className="text-white/90 text-lg font-medium drop-shadow-md">
                        Наведите камеру на код
                    </p>
                 </div>
             )}
         </div>
      )}

      {/* Standard Input UI */}
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