import React, { useState, useEffect } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';

interface Props {
  src?: string;
  alt: string;
  className?: string;
}

export const ProductImage: React.FC<Props> = ({ src, alt, className = "" }) => {
  const [imgSrc, setImgSrc] = useState<string | undefined>(src);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Reset state if src prop changes (e.g., scanning a new item)
  useEffect(() => {
    setImgSrc(src);
    setHasError(false);
    setIsLoading(true);
  }, [src]);

  const handleError = () => {
    if (imgSrc && imgSrc.endsWith('.webp')) {
      // First Fallback: Try JPG if WebP fails
      setImgSrc(imgSrc.replace('.webp', '.jpg'));
    } else {
      // Final Fallback: Show placeholder
      setHasError(true);
      setIsLoading(false);
    }
  };

  const handleLoad = () => {
    setIsLoading(false);
  };

  if (!src || hasError) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 text-gray-300 ${className}`}>
        <ImageOff className="w-1/3 h-1/3" />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Loading Skeleton */}
      {isLoading && (
        <div className="absolute inset-0 bg-gray-100 animate-pulse flex items-center justify-center z-10">
           <Loader2 className="w-8 h-8 text-gray-300 animate-spin" />
        </div>
      )}
      <img 
        src={imgSrc} 
        alt={alt}
        className={`w-full h-full object-contain mix-blend-multiply transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
        onError={handleError}
        onLoad={handleLoad}
      />
    </div>
  );
};