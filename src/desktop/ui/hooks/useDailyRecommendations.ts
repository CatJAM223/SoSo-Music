import { useCallback, useEffect, useRef, useState } from 'react';
import { readTastePolicy, refreshTastePolicy } from '../../../shared/hooks/useTastePolicy';
import type { Track, MusicSource } from '../../../shared/types';
import { dailyDislikeKey } from '../../../shared/utils/dailyDislikes';
import {
  createDailyRecommendationLoader,
  localRecommendationDay,
} from '../../../shared/utils/dailyRecommendations';

let load: ReturnType<typeof createDailyRecommendationLoader> | undefined;
function loader() {
  if (!load)
    load = createDailyRecommendationLoader(
      {
        getItem: (key) => window.localStorage.getItem(key),
        setItem: (key, value) => window.localStorage.setItem(key, value),
      },
      (previous, previousTracks, options) => {
        if (!window.electronAPI?.getRecommendedTracks)
          throw new Error('Recommendations API unavailable');
        return window.electronAPI.getRecommendedTracks(previous, previousTracks, options);
      },
      () => new Date(),
      () => readTastePolicy().revision,
    );
  return load;
}

export function useDailyRecommendations(
  dislikedTrackIds: ReadonlySet<string>,
  source: MusicSource = 'all',
) {
  const dislikeKey = dailyDislikeKey(dislikedTrackIds);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const day = useRef('');
  const publishedKey = useRef('');
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const snapshotKey = JSON.stringify([localRecommendationDay(), dislikeKey, source]);
    if (publishedKey.current !== snapshotKey) {
      setTracks([]);
      setLoading(true);
    }
    setFailed(false);

    try {
      await refreshTastePolicy();
      if (request !== generation.current) return;
      const result = await loader()(dislikeKey, source);
      if (request !== generation.current) return;
      if (
        result.day !== localRecommendationDay() ||
        result.tasteRevision !== readTastePolicy().revision ||
        result.dislikeKey !== dislikeKey
      ) {
        void refresh();
        return;
      }
      day.current = result.day;
      publishedKey.current = snapshotKey;
      setTracks(result.tracks);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [dislikeKey, source]);
  useEffect(() => {
    if (loading || failed || tracks.length >= 5) return;
    const retry = setTimeout(() => void refresh(), 5 * 60 * 1000);
    return () => clearTimeout(retry);
  }, [loading, failed, tracks, refresh]);
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(
        () => {
          void refresh();
          schedule();
        },
        tomorrow.getTime() - now.getTime() + 100,
      );
    };
    const resumed = () => {
      if (day.current !== localRecommendationDay()) void refresh();
    };
    schedule();
    const policyChanged = () => {
      void refresh();
    };
    window.addEventListener('soso:taste-policy-changed', policyChanged);
    window.addEventListener('focus', resumed);
    document.addEventListener('visibilitychange', resumed);
    return () => {
      generation.current++;
      clearTimeout(timer);
      window.removeEventListener('soso:taste-policy-changed', policyChanged);
      window.removeEventListener('focus', resumed);
      document.removeEventListener('visibilitychange', resumed);
    };
  }, [refresh]);
  return { tracks, loading, failed, retry: refresh };
}
