import { useEffect } from 'react';
import { Track } from '../types';
import { detectTrackSource, resolveTrackCover } from '../utils/formatters';

interface UseDiscordRpcProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  duration: number;
  currentTime: number;
  getCurrentTime: () => number;
}

const isDiscordEnabled = (): boolean => {
  try {
    return localStorage.getItem('soso_discord_rpc') !== 'false';
  } catch {
    return true;
  }
};

export function useDiscordRpc({
  currentTrack,
  isPlaying,
  duration,
  currentTime,
  getCurrentTime,
}: UseDiscordRpcProps) {
  // Sync playback state with Discord Rich Presence on track change / play / pause
  useEffect(() => {
    if (!(window as any).electronAPI?.updateDiscordRpc) return;

    if (!isDiscordEnabled()) {
      (window as any).electronAPI.clearDiscordRpc?.();
      return;
    }

    if (currentTrack) {
      const artistName =
        currentTrack.artist?.name ||
        (typeof currentTrack.artist === 'string' ? currentTrack.artist : '') ||
        'Исполнитель';

      const albumTitle =
        currentTrack.album?.title ||
        (typeof currentTrack.album === 'string' ? currentTrack.album : '') ||
        'SoSo Music';

      const coverUrl = resolveTrackCover(currentTrack, '');

      (window as any).electronAPI.updateDiscordRpc({
        trackId: currentTrack.id,
        source: detectTrackSource(currentTrack),
        title: currentTrack.title || 'Трек',
        artist: artistName,
        album: albumTitle,
        duration: duration || currentTrack.duration || 180,
        currentTime: getCurrentTime() || currentTime,
        isPlaying: isPlaying,
        coverUrl: coverUrl,
      });
    } else {
      (window as any).electronAPI.clearDiscordRpc?.();
    }
  }, [currentTrack?.id, isPlaying, duration]);

  // Periodic Discord RPC update while playing (every 5s) to maintain sync
  useEffect(() => {
    if (!isPlaying || !currentTrack || !(window as any).electronAPI?.updateDiscordRpc) return;
    if (!isDiscordEnabled()) return;

    const interval = setInterval(() => {
      if (currentTrack) {
        const artistName =
          currentTrack.artist?.name ||
          (typeof currentTrack.artist === 'string' ? currentTrack.artist : '') ||
          'Исполнитель';
        const albumTitle =
          currentTrack.album?.title ||
          (typeof currentTrack.album === 'string' ? currentTrack.album : '') ||
          'SoSo Music';
        const coverUrl = resolveTrackCover(currentTrack, '');

        const curTime = getCurrentTime();
        (window as any).electronAPI?.updateDiscordRpc({
          trackId: currentTrack.id,
          source: detectTrackSource(currentTrack),
          title: currentTrack.title || 'Трек',
          artist: artistName,
          album: albumTitle,
          duration: duration || currentTrack.duration || 180,
          currentTime: curTime || 0,
          isPlaying: true,
          coverUrl: coverUrl,
        });
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isPlaying, currentTrack?.id, duration]);
}
