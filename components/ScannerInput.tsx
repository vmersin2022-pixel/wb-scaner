import React, { useEffect, useRef, useState } from 'react';

interface ScannerInputProps {
  onScan: (code: string) => void;
  isDisabled?: boolean;
  placeholder?: string;
}

export const ScannerInput: React.FC<ScannerInputProps> = ({ onScan, isDisabled, placeholder }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [buffer, setBuffer] = useState('');

  // Keep focus alive
  useEffect(() => {
    const focusInput = () => {
      if (!isDisabled && inputRef.current) {
        // Only verify focus if we aren't editing another input
        if (document.activeElement?.tagName !== 'INPUT' || document.activeElement === inputRef.current) {
           inputRef.current.focus();
        }
      }
    };

    // Initial focus
    focusInput();
    
    // Interval check
    const interval = setInterval(focusInput, 2000);
    
    // Click handler to re-focus unless clicking button/other input
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBuffer(e.target.value);
  };

  return (
    <div className="w-full mt-6">
      <input
        ref={inputRef}
        type="text"
        value={buffer}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        disabled={isDisabled}
        placeholder={placeholder}
        className="w-full p-4 text-lg border-2 border-blue-500 rounded-lg focus:outline-none focus:ring-4 focus:ring-blue-200 transition-all text-gray-700 placeholder-gray-400 bg-white shadow-sm"
      />
    </div>
  );
};