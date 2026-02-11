import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ScanBarcode, Keyboard, Camera, X } from 'lucide-react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';

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
  
  // Timer for auto-submission (debounce)
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- HARDWARE SCANNER LOGIC (Auto-Focus & Auto-Submit) ---
  
  // 1. Aggressive Focus
  useEffect(() => {
    const focusInput = () => {
      if (!isDisabled && !showCamera && inputRef.current) {
        // Only verify focus if we aren't editing another input
        if (document.activeElement?.tagName !== 'INPUT' || document.activeElement === inputRef.current) {
           inputRef.current.focus({ preventScroll: true });
        }
      }
    };

    focusInput();
    const interval = setInterval(focusInput, 1500); // Check periodically
    
    const handleClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // Don't steal focus if clicking buttons or other inputs
        if (target.tagName !== 'BUTTON' && target.tagName !== 'INPUT' && !showCamera) {
            focusInput();
        }
    }

    window.addEventListener('click', handleClick);
    return () => {
      clearInterval(interval);
      window.removeEventListener('click', handleClick);
    };
  }, [isDisabled, showCamera]);

  // 2. Auto-submit logic
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setBuffer(val);

    // Clear previous timer
    if (submitTimerRef.current) clearTimeout(submitTimerRef.current);

    // If empty, do nothing
    if (!val.trim()) return;

    // Set new timer: if no new input for 200ms, submit automatically
    // Hardware scanners type very fast (approx 20-50ms per char). Humans type slower.
    submitTimerRef.current = setTimeout(() => {
        if (val.trim().length > 0) {
            triggerScan(val.trim());
        }
    }, 250); // 250ms threshold
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
      if (buffer.trim().length > 0) {
        triggerScan(buffer.trim());
      }
    }
  };

  const triggerScan = (code: string) => {
    onScan(code);
    setBuffer('');
  };

  // --- CAMERA LOGIC ---
  
  useEffect(() => {
    if (!showCamera) return;

    const scannerId = "html5qr-code-full-region";
    
    // Config for formats: Code 128 (WB), Data Matrix (KIZ), EAN
    const config = { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
        formatsToSupport: [ 
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.DATAMATRIX,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.QR_CODE
        ]
    };

    const scanner = new Html5QrcodeScanner(scannerId, config, false);

    scanner.render(
        (decodedText) => {
            // Success callback
            console.log("Camera Scan:", decodedText);
            triggerScan(decodedText);
            setShowCamera(false); // Close camera on success
            scanner.clear().catch(console.error);
        },
        (errorMessage) => {
            // Parse error, ignore usually
        }
    );

    return () => {
        scanner.clear().catch(console.error);
    };
  }, [showCamera]);


  // --- VISUALS ---

  const borderColor = mode === 'active' ? 'border-fuchsia-500' : 'border-gray-300';
  const ringColor = mode === 'active' ? 'ring-fuchsia-200' : 'ring-gray-100';
  const iconColor = mode === 'active' ? 'text-fuchsia-600' : 'text-gray-400';

  return (
    <div className="w-full mt-4 relative group">
      
      {/* Camera Modal Overlay */}
      {showCamera && (
         <div className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-center p-4 animate-in fade-in">
             <button 
                onClick={() => setShowCamera(false)}
                className="absolute top-4 right-4 bg-white/20 p-2 rounded-full text-white z-50 backdrop-blur-md"
             >
                <X className="w-8 h-8" />
             </button>
             <div className="w-full max-w-sm bg-white rounded-2xl overflow-hidden shadow-2xl">
                 <div id="html5qr-code-full-region" className="w-full"></div>
             </div>
             <p className="text-white mt-6 text-center text-lg font-medium opacity-80">
                Наведите камеру на код
             </p>
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
      
      {/* Placeholder Label */}
      <div className={`absolute left-12 top-0 h-full flex items-center pointer-events-none transition-all duration-300 ${buffer ? 'opacity-0' : 'opacity-100'}`}>
        <span className={`text-lg ${mode === 'active' ? 'text-fuchsia-600 font-medium' : 'text-gray-400'}`}>
            {placeholder || "Сканировать..."}
        </span>
      </div>

      {/* Camera Toggle Button */}
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