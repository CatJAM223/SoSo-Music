import type { Track, WaveMood } from '../types/index.ts';

interface WaveModeSession {
  artistFeedback: Map<string, number>;
  positiveTracks: Track[];
  skippedTracks: Track[];
}

/** Short-lived station reactions are separate from the shared, lasting taste profile. */
export function createWaveSessionState() {
  const modes = new Map<WaveMood, WaveModeSession>();
  return {
    forMode(mood: WaveMood): WaveModeSession {
      let session = modes.get(mood);
      if (!session) {
        session = { artistFeedback: new Map(), positiveTracks: [], skippedTracks: [] };
        modes.set(mood, session);
      }
      return session;
    },
    clear() {
      modes.clear();
    },
  };
}
