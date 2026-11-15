import { useEffect } from 'react';
import type { Track } from '../types';
import { detectTrackSource, resolveTrackCover } from '../utils/formatters';

export function useDiscordRpc({
  currentTrack,
  isPlaying,
  duration,
  audio,
}: {
  currentTrack: Track | null;
  isPlaying: boolean;
  duration: number;
  audio: HTMLAudioElement | null;
}) {
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.updateDiscordRpc) return;
    const publish = () => {
      try {
        if (localStorage.getItem('soso_discord_rpc') === 'false') return;
      } catch {
        // Restricted storage falls back to the default setting.
      }
      if (!currentTrack) {
        void api.clearDiscordRpc?.();
        return;
      }
      void api.updateDiscordRpc({
        trackId: currentTrack.id,
        source: detectTrackSource(currentTrack),
        title: currentTrack.title || 'Трек',
        artist:
          currentTrack.artist?.name ||
          (typeof currentTrack.artist === 'string' ? currentTrack.artist : '') ||
          'Исполнитель',
        album:
          currentTrack.album?.title ||
          (typeof currentTrack.album === 'string' ? currentTrack.album : '') ||
          'SoSo Music',
        duration:
          Number.isFinite(duration) && duration > 0 ? duration : currentTrack.duration || 180,
        currentTime: audio?.currentTime ?? 0,
        isPlaying: isPlaying && !!audio && !audio.paused && audio.readyState >= 3,
        coverUrl: resolveTrackCover(currentTrack, ''),
      });
    };
    publish();
    audio?.addEventListener('seeked', publish);
    audio?.addEventListener('playing', publish);
    audio?.addEventListener('waiting', publish);
    window.addEventListener('soso:discord-rpc-changed', publish);
    return () => {
      audio?.removeEventListener('seeked', publish);
      audio?.removeEventListener('playing', publish);
      audio?.removeEventListener('waiting', publish);
      window.removeEventListener('soso:discord-rpc-changed', publish);
    };
  }, [currentTrack, duration, isPlaying, audio]);
}
