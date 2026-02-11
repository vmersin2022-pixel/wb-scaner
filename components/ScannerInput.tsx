import React, { useEffect, useRef, useState } from 'react';
import { ScanBarcode, Camera, X, Keyboard } from 'lucide-react';
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
  const [value, setValue] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // --- KIOSK MODE: AUTO FOCUS INPUT ---
  const focusInput = () => {
      if (!showCamera && !isDisabled && inputRef.current) {
          inputRef.current.focus();
      }
  };

  useEffect(() => {
    focusInput();
    const handleRefocus = () => { setTimeout(focusInput, 50); };
    const interval = setInterval(focusInput, 2000); 
    
    window.addEventListener('click', handleRefocus);
    window.addEventListener('focus', handleRefocus);
    
    return () => {
        clearInterval(interval);
        window.removeEventListener('click', handleRefocus);
        window.removeEventListener('focus', handleRefocus);
    };
  }, [showCamera, isDisabled]);

  // --- AUTO-SUBMIT LOGIC (DEBOUNCE) ---
  useEffect(() => {
    // Если поле пустое, ничего не делаем
    if (!value) return;

    // Таймер: если ввода нет 200мс, считаем что сканер закончил
    const timeoutId = setTimeout(() => {
        if (value.trim().length >= 3) { // Минимальная длина для защиты от случайных нажатий
            onScan(value.trim());
            setValue('');
        }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [value, onScan]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
         if (value.trim().length > 0) {
            onScan(value.trim());
            setValue('');
         }
      }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
  };

  // --- CAMERA LOGIC ---
  const handleCloseCamera = async () => {
      if (scannerRef.current) {
          try { await scannerRef.current.stop(); scannerRef.current.clear(); } catch(e){}
      }
      setShowCamera(false);
      setTimeout(focusInput, 100);
  };

  useEffect(() => {
    if (!showCamera) return;
    setCameraError(null);
    const id = "reader";
    
    setTimeout(() => {
        const scanner = new Html5Qrcode(id);
        scannerRef.current = scanner;
        const config = { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };
        
        scanner.start({ facingMode: "environment" }, config, 
            (decoded) => {
                handleCloseCamera();
                onScan(decoded);
            },
            () => {}
        ).catch(err => {
            console.error(err);
            setCameraError("Камера недоступна");
        });
    }, 100);

    return () => {
        if (scannerRef.current?.isScanning) scannerRef.current.stop();
    };
  }, [showCamera]);

  const borderColor = mode === 'active' ? 'border-fuchsia-500 ring-2 ring-fuchsia-100' : 'border-gray-300';
  
  return (
    <div className="w-full mt-4 relative">
      
      {/* Fullscreen Camera Overlay */}
      {showCamera && (
         <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
             <div className="p-4 flex justify-end"><button onClick={handleCloseCamera} className="text-white bg-white/20 p-2 rounded-full"><X /></button></div>
             <div id="reader" className="flex-1 w-full h-full bg-black"></div>
             {cameraError && <div className="text-white text-center p-4">{cameraError}</div>}
         </div>
      )}

      {/* Input Field */}
      <div className={`relative flex items-center bg-white rounded-xl border-2 shadow-sm transition-all ${borderColor} h-14 overflow-hidden`}>
        <div className="pl-4 pr-3 text-gray-400">
           {mode === 'active' ? <ScanBarcode className="w-6 h-6 animate-pulse text-fuchsia-600" /> : <Keyboard className="w-6 h-6" />}
        </div>
        
        <input 
            ref={inputRef}
            type="text" 
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={isDisabled}
            className="flex-1 h-full outline-none text-lg font-mono font-medium tracking-wider text-gray-900 placeholder:font-sans placeholder:text-gray-400 placeholder:opacity-60 bg-transparent"
            placeholder={placeholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            autoFocus
        />

        {/* Camera Toggle */}
        <button 
           onClick={() => setShowCamera(true)}
           disabled={isDisabled}
           className="h-full px-4 text-gray-400 hover:text-gray-600 border-l border-gray-100 active:bg-gray-50 bg-gray-50/50"
        >
           <Camera className="w-6 h-6" />
        </button>
      </div>

      <div className="text-[10px] text-gray-400 text-center mt-2 font-medium uppercase tracking-wider">
         {isDisabled ? "Загрузка..." : "Курсор установлен • Авто-ввод активен"}
      </div>
    </div>
  );
};