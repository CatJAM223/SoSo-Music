import React from 'react';
import { ListMusic } from 'lucide-react';

interface PlaylistCoverProps {
  covers?: string[];
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const PlaylistCover: React.FC<PlaylistCoverProps> = ({
  covers = [],
  size = 'md',
  className = '',
}) => {
  // Filter out empty or unsplash placeholders
  const validCovers = covers.filter(
    (c) => Boolean(c) && !c.includes('unsplash.com') && !c.includes('default'),
  );

  let sizeClass = 'w-12 h-12 rounded-xl text-base';
  if (size === 'sm') sizeClass = 'w-7 h-7 rounded-lg text-xs';
  if (size === 'lg') sizeClass = 'w-32 h-32 sm:w-40 sm:h-40 rounded-2xl text-2xl';
  if (size === 'xl') sizeClass = 'w-44 h-44 sm:w-56 sm:h-56 rounded-3xl text-3xl shadow-2xl';

  // 1. If 4 or more covers: render high-quality 2x2 mosaic
  if (validCovers.length >= 4) {
    return (
      <div
        className={`grid grid-cols-2 grid-rows-2 overflow-hidden shrink-0 bg-zinc-900 ring-1 ring-white/10 ${sizeClass} ${className}`}
      >
        {validCovers.slice(0, 4).map((c, i) => (
          <img
            key={i}
            src={c}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ))}
      </div>
    );
  }

  // 2. If 1 to 3 covers: show the first cover prominently
  if (validCovers.length > 0) {
    return (
      <div
        className={`overflow-hidden shrink-0 bg-zinc-900 ring-1 ring-white/10 ${sizeClass} ${className}`}
      >
        <img
          src={validCovers[0]}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    );
  }

  // 3. Fallback: Artistic Gradient Capsule
  return (
    <div
      className={`flex items-center justify-center shrink-0 bg-linear-to-br from-soso-brand/20 via-zinc-900 to-zinc-950 text-soso-brand ring-1 ring-white/10 shadow-md ${sizeClass} ${className}`}
    >
      <ListMusic className="w-1/2 h-1/2 opacity-80" />
    </div>
  );
};
