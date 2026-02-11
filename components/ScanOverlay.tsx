import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

interface Props {
  status: 'SUCCESS' | 'ERROR' | null;
  message?: string;
}

export const ScanOverlay: React.FC<Props> = ({ status, message }) => {
  if (!status) return null;

  const isSuccess = status === 'SUCCESS';

  return (
    <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center p-6 transition-all duration-300 backdrop-blur-sm ${
      isSuccess ? 'bg-green-500/80' : 'bg-red-600/80'
    }`}>
      <div className="bg-white p-6 rounded-full shadow-2xl mb-6 animate-bounce">
        {isSuccess ? (
          <CheckCircle2 className="w-20 h-20 text-green-600" />
        ) : (
          <XCircle className="w-20 h-20 text-red-600" />
        )}
      </div>
      
      {message && (
        <h2 className="text-4xl font-black text-white uppercase tracking-wider drop-shadow-lg text-center leading-tight">
          {message}
        </h2>
      )}
    </div>
  );
};