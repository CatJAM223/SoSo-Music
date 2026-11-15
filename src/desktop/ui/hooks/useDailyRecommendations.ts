import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readTastePolicy, refreshTastePolicy } from '../../../shared/hooks/useTastePolicy';
import { useWindowVisible } from '../../../shared/hooks/useWindowVisible';
import type { Track, MusicSource } from '../../../shared/types';
import type { AudioControlsContextType } from '../../../shared/context/audioTypes';
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
  waveSearchOptions?: AudioControlsContextType['waveSearchOptions'],
) {
  const dislikeKey = useMemo(() => dailyDislikeKey(dislikedTrackIds), [dislikedTrackIds]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const visible = useWindowVisible();
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const refreshOnShow = useRef(false);
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
      const result = await loader()(dislikeKey, source, waveSearchOptions?.('default', source));
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
  }, [dislikeKey, source, waveSearchOptions]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!visible || loading || failed || tracks.length >= 5) return;
    const retry = setTimeout(() => void refresh(), 5 * 60 * 1000);
    return () => clearTimeout(retry);
  }, [visible, loading, failed, tracks, refresh]);
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (visibleRef.current) {
        refreshOnShow.current = false;
        void refresh();
      } else refreshOnShow.current = true;
    };
    refreshWhenVisible();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(
        () => {
          refreshWhenVisible();
          schedule();
        },
        tomorrow.getTime() - now.getTime() + 100,
      );
    };
    schedule();
    const resumed = () => {
      if (day.current && day.current !== localRecommendationDay()) refreshWhenVisible();
    };
    window.addEventListener('soso:taste-policy-changed', refreshWhenVisible);
    window.addEventListener('focus', resumed);
    return () => {
      generation.current++;
      clearTimeout(timer);
      window.removeEventListener('soso:taste-policy-changed', refreshWhenVisible);
      window.removeEventListener('focus', resumed);
    };
  }, [refresh]);
  useEffect(() => {
    if (!visible || (!refreshOnShow.current && day.current === localRecommendationDay())) return;
    if (!refreshOnShow.current && !day.current) return; // Initial refresh is already in flight.
    refreshOnShow.current = false;
    void refreshRef.current();
  }, [visible]);
  return { tracks, loading, failed, retry: refresh };
}
