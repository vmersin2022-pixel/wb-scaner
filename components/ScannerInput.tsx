import React, { useEffect, useRef, useState } from 'react';
import { ScanBarcode, Keyboard } from 'lucide-react';

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

  // Keep focus alive aggressively
  useEffect(() => {
    const focusInput = () => {
      if (!isDisabled && inputRef.current) {
        // Only verify focus if we aren't editing another input
        if (document.activeElement?.tagName !== 'INPUT' || document.activeElement === inputRef.current) {
           inputRef.current.focus({ preventScroll: true });
        }
      }
    };

    focusInput();
    const interval = setInterval(focusInput, 1000);
    
    const handleClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'BUTTON' && target.tagName !== 'INPUT') {
            focusInput();
        }
    }

    window.addEventListener('click', handleClick);
    return () => {
      clearInterval(interval);
      window.removeEventListener('click', handleClick);
    };
  }, [isDisabled]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (buffer.trim().length > 0) {
        onScan(buffer.trim());
        setBuffer('');
      }
    }
  };

  // Visual styles based on mode
  const borderColor = mode === 'active' ? 'border-fuchsia-500' : 'border-gray-300';
  const ringColor = mode === 'active' ? 'ring-fuchsia-200' : 'ring-gray-100';
  const iconColor = mode === 'active' ? 'text-fuchsia-600' : 'text-gray-400';

  return (
    <div className="w-full mt-4 relative group">
      <div className={`absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none ${iconColor} transition-colors duration-300`}>
        <ScanBarcode className={`w-6 h-6 ${mode === 'active' ? 'animate-pulse' : ''}`} />
      </div>
      
      <input
        ref={inputRef}
        type="text"
        value={buffer}
        onChange={(e) => setBuffer(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        autoComplete="off"
        disabled={isDisabled}
        className={`w-full pl-12 pr-12 py-4 text-xl font-mono tracking-wide rounded-xl border-2 bg-white shadow-sm transition-all duration-300
          ${borderColor} 
          ${isFocused ? `ring-4 ${ringColor} ${mode === 'active' ? 'animate-glow' : ''}` : 'opacity-80'}
          focus:outline-none`}
        placeholder="" 
      />
      
      {/* Animated Placeholder Label */}
      <div className={`absolute left-12 top-0 h-full flex items-center pointer-events-none transition-all duration-300 ${buffer ? 'opacity-0' : 'opacity-100'}`}>
        <span className={`text-lg ${mode === 'active' ? 'text-fuchsia-600 font-medium' : 'text-gray-400'}`}>
            {placeholder || "Готов к сканированию..."}
        </span>
      </div>

      <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-gray-300">
        <Keyboard className="w-5 h-5" />
      </div>
    </div>
  );
};
