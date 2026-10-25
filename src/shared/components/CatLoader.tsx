import React from 'react';
import appLogo from '../../renderer/assets/icon.png';

export interface CatLoaderProps {
  size?: 'sm' | 'md' | 'lg' | 'fullscreen';
  message?: string;
  className?: string;
}

export const CatLoader: React.FC<CatLoaderProps> = ({ size = 'md', message, className = '' }) => {
  const ringSizes = {
    sm: 'w-10 h-10',
    md: 'w-16 h-16',
    lg: 'w-24 h-24',
    fullscreen: 'w-20 h-20',
  };

  const logoSizes = {
    sm: 'w-6 h-6',
    md: 'w-9 h-9',
    lg: 'w-14 h-14',
    fullscreen: 'w-12 h-12',
  };

  const containerClasses =
    size === 'fullscreen'
      ? 'fixed inset-0 z-50 bg-[var(--bg-app)] flex flex-col items-center justify-center p-8'
      : 'py-16 flex flex-col items-center justify-center';

  return (
    <div
      data-fullscreen-loader={size === 'fullscreen' || undefined}
      className={`${containerClasses} select-none ${className} ${size === 'fullscreen' ? '' : 'animate-fade-in'}`}
    >
      <div className="relative flex items-center justify-center">
        {/* Soft Ambient Brand Glow */}
        <div className="absolute inset-0 rounded-full bg-soso-brand/15 dark:bg-soso-brand/20 filter blur-xl animate-pulse-slow" />

        {/* Circular Spinner Ring */}
        <div
          className={`${ringSizes[size]} rounded-full border-2 border-slate-200/80 dark:border-zinc-800 border-t-soso-brand animate-spin`}
          style={{ animationDuration: '0.85s' }}
        />

        {/* Clean Central Logo */}
        <div
          className={`${logoSizes[size]} absolute rounded-xl overflow-hidden shadow-xs flex items-center justify-center ring-1 ring-black/5 dark:ring-white/10`}
        >
          <img
            src={appLogo}
            alt="Loading..."
            className="w-full h-full object-contain pointer-events-none"
            draggable={false}
          />
        </div>
      </div>

      {/* High-Contrast Crisp Caption */}
      {message && (
        <p className="mt-4 text-xs font-semibold tracking-wide text-slate-600 dark:text-zinc-400 text-center animate-pulse-subtle">
          {message}
        </p>
      )}
    </div>
  );
};
