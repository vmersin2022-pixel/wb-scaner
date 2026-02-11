import React, { useEffect, useRef, useState } from 'react';
import { ScanBarcode, Camera, X, AlertCircle, Keyboard } from 'lucide-react';
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
  const [buffer, setBuffer] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  // TSD Mode is default (Global Listener). Camera is optional.
  const bufferRef = useRef('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // --- GLOBAL KEYBOARD LISTENER (TSD / BARCODE SCANNER) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isDisabled || showCamera) return;

      // Ignore modifiers
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;

      // Scanner Terminator (Enter)
      if (e.key === 'Enter') {
         if (bufferRef.current.length > 0) {
            const code = bufferRef.current;
            bufferRef.current = ''; // Clear immediately
            setBuffer('');
            onScan(code);
         }
         return;
      }

      // Buffer printable keys
      if (e.key.length === 1) {
         bufferRef.current += e.key;
         setBuffer(bufferRef.current); // Update UI

         // Safety: Clear buffer if typing stops for 200ms (manual typing vs scanner)
         if (timeoutRef.current) clearTimeout(timeoutRef.current);
         timeoutRef.current = setTimeout(() => {
             // If manual typing, we keep it. If scanner, it usually finishes fast.
             // This logic keeps the buffer valid for manual correction.
         }, 200);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isDisabled, showCamera, onScan]);

  // --- CAMERA LOGIC ---
  const handleCloseCamera = async () => {
      if (scannerRef.current) {
          try { await scannerRef.current.stop(); scannerRef.current.clear(); } catch(e){}
      }
      setShowCamera(false);
  };

  useEffect(() => {
    if (!showCamera) return;
    setCameraError(null);
    const id = "reader";
    
    // Tiny delay to ensure DOM exists
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

  const borderColor = mode === 'active' ? 'border-fuchsia-500' : 'border-gray-300';
  const iconColor = mode === 'active' ? 'text-fuchsia-600' : 'text-gray-400';

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

      {/* Visual Feedback for Buffer (TSD Simulation) */}
      <div className={`relative flex items-center bg-white rounded-xl border-2 shadow-sm transition-colors ${borderColor} h-14`}>
        <div className="pl-4 pr-3 text-gray-400">
           {mode === 'active' ? <ScanBarcode className="w-6 h-6 animate-pulse text-fuchsia-600" /> : <Keyboard className="w-6 h-6" />}
        </div>
        
        <div className="flex-1 text-lg font-mono font-medium tracking-wider truncate text-gray-700">
           {buffer || <span className="text-gray-400 opacity-60 font-sans">{placeholder}</span>}
        </div>

        {/* Camera Toggle */}
        <button 
           onClick={() => setShowCamera(true)}
           disabled={isDisabled}
           className="h-full px-4 text-gray-400 hover:text-gray-600 border-l border-gray-100 active:bg-gray-50 rounded-r-xl"
        >
           <Camera className="w-6 h-6" />
        </button>
      </div>

      <div className="text-[10px] text-gray-400 text-center mt-2 font-medium uppercase tracking-wider">
         {isDisabled ? "Загрузка..." : "Сканер активен • Нажимайте курок"}
      </div>
    </div>
  );
};