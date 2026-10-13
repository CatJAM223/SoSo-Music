import { useCallback, useEffect, useState } from 'react';
import { PlaybackSessionWriter, type PlaybackSessionInput } from '../services/playbackSession';
import type { RepeatMode, Track } from '../types';

interface Props {
  audio: HTMLAudioElement | null;
  getSnapshot: () => PlaybackSessionInput | null;
  track: Track | null;
  queue: Track[];
  queueIndex: number;
  repeatMode: RepeatMode;
  isShuffle: boolean;
}

/** Subscribe once per audio element rather than on every progress render. */
export function usePlaybackPersistence({
  audio,
  getSnapshot,
  track,
  queue,
  queueIndex,
  repeatMode,
  isShuffle,
}: Props): void {
  const [writer] = useState(() => new PlaybackSessionWriter());
  const flush = useCallback(() => {
    writer.save(getSnapshot(), true);
  }, [writer, getSnapshot]);
  useEffect(() => {
    flush();
  }, [flush, track, queue, queueIndex, repeatMode, isShuffle]);
  useEffect(() => {
    const checkpoint = () => {
      writer.save(getSnapshot());
    };
    const background = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    audio?.addEventListener('timeupdate', checkpoint);
    for (const event of ['pause', 'seeked']) audio?.addEventListener(event, flush);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', background);
    return () => {
      flush();
      audio?.removeEventListener('timeupdate', checkpoint);
      for (const event of ['pause', 'seeked']) audio?.removeEventListener(event, flush);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', background);
    };
  }, [audio, writer, getSnapshot, flush]);
}
