import React, { useEffect, useRef, useState } from 'react';

interface ScannerInputProps {
  onScan: (code: string) => void;
  isDisabled?: boolean;
}

export const ScannerInput: React.FC<ScannerInputProps> = ({ onScan, isDisabled }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [buffer, setBuffer] = useState('');

  // Keep focus alive
  useEffect(() => {
    const focusInput = () => {
      if (!isDisabled && inputRef.current) {
        inputRef.current.focus();
      }
    };

    const interval = setInterval(focusInput, 2000);
    window.addEventListener('click', focusInput);
    focusInput();

    return () => {
      clearInterval(interval);
      window.removeEventListener('click', focusInput);
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
    <div className="absolute top-0 left-0 w-0 h-0 overflow-hidden opacity-0">
      <input
        ref={inputRef}
        type="text"
        value={buffer}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        disabled={isDisabled}
      />
    </div>
  );
};