import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

interface Props {
  status: 'SUCCESS' | 'ERROR' | null;
  message?: string;
}

export const ScanOverlay: React.FC<Props> = ({ status, message }) => {
  if (!status) return null;

  const isSuccess = status === 'SUCCESS';
  const bgColor = isSuccess ? 'bg-emerald-500' : 'bg-rose-600';

  return (
    <div className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center p-6 ${bgColor} animate-in fade-in duration-200`}>
      <div className="bg-white/20 backdrop-blur-sm p-12 rounded-full mb-8 shadow-2xl animate-pop-in">
        {isSuccess ? (
          <CheckCircle2 className="w-32 h-32 text-white" />
        ) : (
          <XCircle className="w-32 h-32 text-white" />
        )}
      </div>
      
      {message && (
        <h2 className="text-center font-black text-white text-4xl md:text-6xl uppercase tracking-tight leading-tight drop-shadow-md break-words w-full">
          {message}
        </h2>
      )}
      
      {/* Subtext */}
      <div className="mt-8 text-white/80 font-mono text-xl uppercase tracking-widest font-bold border-2 border-white/30 px-6 py-2 rounded-lg">
         {isSuccess ? 'ГОТОВО' : 'ОШИБКА'}
      </div>
    </div>
  );
};