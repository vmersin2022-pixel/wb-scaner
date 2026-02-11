import React from 'react';
import { CheckCircle2, XCircle, PackageCheck } from 'lucide-react';

interface Props {
  status: 'SUCCESS' | 'ERROR' | null;
  message?: string;
}

export const ScanOverlay: React.FC<Props> = ({ status, message }) => {
  if (!status) return null;

  const isSuccess = status === 'SUCCESS';

  return (
    <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center p-6 backdrop-blur-md transition-all duration-300 animate-in fade-in zoom-in-95 ${
      isSuccess ? 'bg-emerald-500/90' : 'bg-rose-600/90'
    }`}>
      <div className="bg-white p-8 rounded-full shadow-2xl mb-8 animate-pop-in">
        {isSuccess ? (
          <CheckCircle2 className="w-24 h-24 text-emerald-600" />
        ) : (
          <XCircle className="w-24 h-24 text-rose-600" />
        )}
      </div>
      
      {message && (
        <h2 className="text-5xl font-black text-white uppercase tracking-wider text-center leading-tight drop-shadow-md animate-slide-up">
          {message}
        </h2>
      )}
      
      {isSuccess && (
         <div className="mt-4 text-white/80 font-medium text-lg animate-pulse">
            Переход к следующему...
         </div>
      )}
    </div>
  );
};
