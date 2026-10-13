import { useLocale } from '../i18n/useLocale';
import { t } from '../i18n/locale';
import React, { useState, useEffect, useRef } from 'react';
import { Heart } from 'lucide-react';

interface AnimatedLikeButtonProps {
  isLiked: boolean;
  onToggle: (e: React.MouseEvent) => void;
  className?: string;
  iconClassName?: string;
  title?: string;
  ariaLabel?: string;
}

export const AnimatedLikeButton: React.FC<AnimatedLikeButtonProps> = ({
  isLiked,
  onToggle,
  className = '',
  iconClassName = 'w-4 h-4 md:w-5 md:h-5',
  title,
  ariaLabel,
}) => {
  useLocale();
  const [isBreaking, setIsBreaking] = useState(false);
  const prevLikedRef = useRef(isLiked);

  useEffect(() => {
    // Detect transition from liked (true) to unliked (false)
    if (prevLikedRef.current && !isLiked) {
      setIsBreaking(true);
      const timer = setTimeout(() => {
        setIsBreaking(false);
      }, 650);
      return () => clearTimeout(timer);
    }
    prevLikedRef.current = isLiked;
  }, [isLiked]);

  return (
    <div className="relative inline-flex items-center justify-center">
      <button
        type="button"
        onClick={onToggle}
        title={title || (isLiked ? t('Удалить из любимых') : t('Добавить в Мою музыку'))}
        aria-label={ariaLabel || (isLiked ? t('Удалить из любимых') : t('Добавить в Мою музыку'))}
        className={`relative z-10 p-1 rounded-full transition-all duration-150 active:scale-95 ${className}`}
      >
        {/* Base Heart (Filled rose when liked, grey outline when unliked) */}
        <Heart
          className={`${iconClassName} transition-colors ${
            isLiked
              ? 'fill-rose-500 text-rose-500 heart-pop'
              : 'text-slate-400 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        />
      </button>

      {/* Breaking Split Heart Overlay */}
      {isBreaking && (
        <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-center">
          {/* Left Falling Half */}
          <svg
            viewBox="0 0 24 24"
            className={`absolute ${iconClassName} fill-rose-500 text-rose-500 filter drop-shadow-sm animate-heart-break-left`}
          >
            <path d="M12 5.2 L12 8 L10.5 10.5 L12.5 13 L11 15.5 L12 21 L5 14 C3.5 12.55 2 10.8 2 8.5 A5.5 5.5 0 0 1 7.5 3 C9.26 3 10.5 3.5 12 5.2 Z" />
          </svg>

          {/* Right Falling Half */}
          <svg
            viewBox="0 0 24 24"
            className={`absolute ${iconClassName} fill-rose-500 text-rose-500 filter drop-shadow-sm animate-heart-break-right`}
          >
            <path d="M12 5.2 L12 8 L10.5 10.5 L12.5 13 L11 15.5 L12 21 L19 14 C20.5 12.55 22 10.8 22 8.5 A5.5 5.5 0 0 0 16.5 3 C14.74 3 13.5 3.5 12 5.2 Z" />
          </svg>
        </div>
      )}
    </div>
  );
};
