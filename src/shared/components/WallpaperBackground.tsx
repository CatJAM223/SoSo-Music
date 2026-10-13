import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAnimationsPaused } from '../hooks/useAnimationsPaused';

import { toMediaFileUrl } from '../utils/formatters';

const IMAGE_EXTENSIONS = ['gif', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'];

export const toFileUrl = toMediaFileUrl;

const isImageFile = (p: string): boolean => {
  const ext = p.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.includes(ext);
};

export const WallpaperBackground: React.FC = () => {
  const { themePreset, wallpaperPath, wallpaperDim, wallpaperBlur } = useTheme();
  const isPaused = useAnimationsPaused();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasError, setHasError] = useState<boolean>(false);

  const isImage = useMemo(
    () => (wallpaperPath ? isImageFile(wallpaperPath) : false),
    [wallpaperPath],
  );
  const src = useMemo(() => (wallpaperPath ? toFileUrl(wallpaperPath) : null), [wallpaperPath]);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || isPaused || hasError) return;
    void video.play().catch(() => {});
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [src, isImage, isPaused, hasError, themePreset]);

  if (themePreset !== 'wallpaper' || !src || hasError || isPaused) return null;

  const filterStyle = {
    filter: wallpaperBlur > 0 ? `blur(${wallpaperBlur}px)` : undefined,
    transform: wallpaperBlur > 0 ? 'scale(1.06)' : undefined,
  };

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none select-none overflow-hidden z-0"
      style={{ zIndex: 0 }}
    >
      {isImage ? (
        <img
          key={src}
          src={src}
          alt=""
          onError={(e) => {
            console.warn('[WallpaperBackground] Failed to load image:', src, e);
            setHasError(true);
          }}
          className="absolute inset-0 w-full h-full object-cover"
          style={filterStyle}
        />
      ) : (
        <video
          key={src}
          ref={videoRef}
          src={src}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          onError={(e) => {
            console.warn('[WallpaperBackground] Failed to load video:', src, e);
            setHasError(true);
          }}
          className="absolute inset-0 w-full h-full object-cover"
          style={filterStyle}
        />
      )}
      {/* Dim overlay keeps UI text readable over any footage */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: `rgba(0, 0, 0, ${wallpaperDim / 100})` }}
      />
    </div>
  );
};
