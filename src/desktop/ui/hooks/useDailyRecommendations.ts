import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '../../../shared/types';
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
      (previous) => {
        if (!window.electronAPI?.getRecommendedTracks)
          throw new Error('Recommendations API unavailable');
        return window.electronAPI.getRecommendedTracks(previous);
      },
    );
  return load;
}

export function useDailyRecommendations() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const day = useRef('');
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const result = await loader()();
      if (request !== generation.current) return;
      if (result.day !== localRecommendationDay()) {
        void refresh();
        return;
      }
      day.current = result.day;
      setTracks(result.tracks);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
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
    window.addEventListener('focus', resumed);
    document.addEventListener('visibilitychange', resumed);
    return () => {
      generation.current++;
      clearTimeout(timer);
      window.removeEventListener('focus', resumed);
      document.removeEventListener('visibilitychange', resumed);
    };
  }, [refresh]);
  return { tracks, loading, failed, retry: refresh };
}
