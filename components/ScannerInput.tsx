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
        // Проверяем, не фокус ли уже на другом элементе ввода
        if (document.activeElement !== inputRef.current) {
           inputRef.current.focus();
        }
      }
    };

    const interval = setInterval(focusInput, 3000);
    // При клике в любом месте возвращаем фокус, если это не кнопки
    const handleClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'BUTTON' && target.tagName !== 'INPUT') {
            focusInput();
        }
    }

    window.addEventListener('click', handleClick);
    focusInput();

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
    <div className="w-full mt-4">
      <input
        ref={inputRef}
        type="text"
        value={buffer}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        disabled={isDisabled}
        placeholder={placeholder || "Сканируйте здесь..."}
        className="w-full p-4 text-lg border-2 border-blue-400 rounded-lg shadow-sm focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-600 transition-all text-gray-700 placeholder-gray-400 bg-white"
      />
    </div>
  );
};