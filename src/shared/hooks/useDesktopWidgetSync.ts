import { useEffect } from 'react';
import { Track } from '../types';

interface UseDesktopWidgetSyncProps {
  currentTrack: Track | null;
  currentTrackRef: React.MutableRefObject<Track | null>;
  isPlaying: boolean;
  isPlayingRef: React.MutableRefObject<boolean>;
  duration: number;
  likedTrackIds: Set<string>;
  volume: number;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  togglePlay: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  seek: (seconds: number) => void;
  setVolume: (val: number) => void;
  toggleLike: (track: Track) => Promise<boolean>;
}

export function useDesktopWidgetSync({
  currentTrack,
  currentTrackRef,
  isPlaying,
  isPlayingRef,
  duration,
  likedTrackIds,
  volume,
  audioRef,
  togglePlay,
  nextTrack,
  prevTrack,
  seek,
  setVolume,
  toggleLike,
}: UseDesktopWidgetSyncProps) {
  // Sync playback state to Desktop Mini-Widget (only on discrete state changes, avoiding IPC flooding)
  useEffect(() => {
    if (window.electronAPI?.sendWidgetState) {
      const idStr = currentTrack ? String(currentTrack.id) : '';
      const isLiked = likedTrackIds.has(idStr);
      window.electronAPI.sendWidgetState({
        track: currentTrack,
        isPlaying,
        currentTime: audioRef.current?.currentTime || 0,
        duration: duration || 180,
        isLiked,
        volume,
      });
    }
  }, [currentTrack, isPlaying, duration, likedTrackIds, volume, audioRef]);

  // Periodic throttled sync (every 5 seconds) to prevent any drift in Mini-Widget without IPC flooding
  useEffect(() => {
    if (!isPlaying || !window.electronAPI?.sendWidgetState) return;
    const interval = setInterval(() => {
      if (window.electronAPI?.sendWidgetState && currentTrackRef.current) {
        const idStr = String(currentTrackRef.current.id);
        const isLiked = likedTrackIds.has(idStr);
        window.electronAPI.sendWidgetState({
          track: currentTrackRef.current,
          isPlaying: true,
          currentTime: audioRef.current?.currentTime || 0,
          duration: audioRef.current?.duration || 180,
          isLiked,
          volume: audioRef.current?.volume ?? 1,
        });
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isPlaying, likedTrackIds, currentTrackRef, audioRef]);

  // Listen to remote commands from Desktop Mini-Widget
  useEffect(() => {
    if (window.electronAPI?.onWidgetCommand) {
      const cleanup = window.electronAPI.onWidgetCommand((command, data) => {
        switch (command) {
          case 'requestState':
            if (window.electronAPI?.sendWidgetState) {
              const idStr = currentTrackRef.current ? String(currentTrackRef.current.id) : '';
              const isLiked = likedTrackIds.has(idStr);
              window.electronAPI.sendWidgetState({
                track: currentTrackRef.current,
                isPlaying: isPlayingRef.current,
                currentTime: audioRef.current?.currentTime || 0,
                duration: audioRef.current?.duration || duration || 180,
                isLiked,
                volume: audioRef.current?.volume ?? 1,
              });
            }
            break;
          case 'togglePlay':
            togglePlay();
            break;
          case 'next':
            nextTrack();
            break;
          case 'prev':
            prevTrack();
            break;
          case 'seek':
            if (typeof data === 'number') seek(data);
            break;
          case 'setVolume':
            if (typeof data === 'number') setVolume(data);
            break;
          case 'toggleLike':
            if (currentTrackRef.current) toggleLike(currentTrackRef.current);
            break;
        }
      });
      return cleanup;
    }
  }, [
    togglePlay,
    nextTrack,
    prevTrack,
    seek,
    setVolume,
    toggleLike,
    likedTrackIds,
    duration,
    currentTrackRef,
    isPlayingRef,
    audioRef,
  ]);
}
