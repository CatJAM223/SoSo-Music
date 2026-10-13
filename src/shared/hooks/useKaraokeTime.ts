import { useEffect, useState } from 'react';

export function useKaraokeTime(enabled: boolean, getPlaybackTime: () => number): number {
  const [time, setTime] = useState(getPlaybackTime);

  useEffect(() => {
    if (!enabled) return;
    let frame: number;
    const update = () => {
      // Read the media clock directly. Wall time keeps advancing during buffering.
      setTime(getPlaybackTime());
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [enabled, getPlaybackTime]);

  return time;
}
