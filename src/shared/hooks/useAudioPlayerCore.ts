import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { PlaybackEngine, type PlaybackEngineDependencies } from '../services/playbackEngine';
/** React only subscribes to the engine and connects the latest library/queue dependencies. */
export function useAudioPlayerCore(dependencies: PlaybackEngineDependencies) {
  const owner = useRef<PlaybackEngine | null>(null);
  if (!owner.current) owner.current = new PlaybackEngine(dependencies);
  const engine = owner.current;
  engine.setDependencies(dependencies);
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  useEffect(() => {
    engine.mount();
    return () => engine.dispose();
  }, [engine]);
  return useMemo(() => ({ ...engine.getControls(), ...snapshot }), [engine, snapshot]);
}
