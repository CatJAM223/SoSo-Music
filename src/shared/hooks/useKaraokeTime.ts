import { useEffect, useState } from 'react';
import { useWindowVisible } from './useWindowVisible';

export function useKaraokeTime(
  enabled: boolean,
  read: () => number,
  playing = true,
  position?: number,
): number {
  const [time, setTime] = useState(read);
  const visible = useWindowVisible();

  useEffect(() => {
    if (!enabled || !visible) return;
    let frame = 0;
    const update = () => {
      // Read the media clock directly. Wall time keeps advancing during buffering.
      setTime(read());
      if (playing) frame = requestAnimationFrame(update);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      update();
    };
    sync();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [enabled, read, playing, position, visible]);

  return time;
}
