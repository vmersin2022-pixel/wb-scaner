import React from 'react';

interface Props {
  status: 'SUCCESS' | 'ERROR' | null;
  message?: string;
}

export const ScanOverlay: React.FC<Props> = ({ status, message }) => {
  if (!status) return null;

  const bgClass = status === 'SUCCESS' 
    ? 'bg-green-500/90 animate-flash-green' 
    : 'bg-red-600/90 animate-pulse';

  const icon = status === 'SUCCESS' ? (
    <svg className="w-24 h-24 text-white mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  ) : (
    <svg className="w-24 h-24 text-white mb-4 animate-shake" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );

  return (
    <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center text-center p-6 ${bgClass} transition-all duration-300`}>
      {icon}
      {message && (
        <h2 className="text-3xl font-bold text-white uppercase tracking-wider drop-shadow-md">
          {message}
        </h2>
      )}
    </div>
  );
};