import { useEffect, useRef } from 'react';

interface UseAudioKeyboardShortcutsProps {
  togglePlay: () => void;
  seek: (seconds: number) => void;
  setVolume: (val: number) => void;
  volume: number;
  nextTrack: () => void;
  prevTrack: () => void;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
}

export function useAudioKeyboardShortcuts({
  togglePlay,
  seek,
  setVolume,
  volume,
  nextTrack,
  prevTrack,
  audioRef,
}: UseAudioKeyboardShortcutsProps) {
  const keyboardActionsRef = useRef({
    togglePlay,
    seek,
    setVolume,
    volume,
    nextTrack,
    prevTrack,
  });

  keyboardActionsRef.current = {
    togglePlay,
    seek,
    setVolume,
    volume,
    nextTrack,
    prevTrack,
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.defaultPrevented ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.isComposing ||
        (e.repeat && ['Space', 'KeyN', 'KeyP'].includes(e.code)) ||
        target?.isContentEditable ||
        target?.closest?.(
          'input, textarea, button, a, select, [role="button"], [role="slider"], [role="textbox"], [contenteditable="true"]',
        )
      ) {
        return;
      }

      const actions = keyboardActionsRef.current;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          actions.togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (audioRef.current) {
            actions.seek(audioRef.current.currentTime - 5);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (audioRef.current) {
            actions.seek(audioRef.current.currentTime + 5);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          actions.setVolume(actions.volume + 0.05);
          break;
        case 'ArrowDown':
          e.preventDefault();
          actions.setVolume(actions.volume - 0.05);
          break;
        case 'KeyN':
          e.preventDefault();
          actions.nextTrack();
          break;
        case 'KeyP':
          e.preventDefault();
          actions.prevTrack();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [audioRef]);
}
