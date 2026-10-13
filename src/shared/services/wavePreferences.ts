import { waveMusicProfile } from '../utils/waveMusicProfile.ts';
import type { Track } from '../types/index.ts';
import { waveMemoryTrack } from './waveMemory.ts';
import { getWaveArtistKeys } from '../utils/waveIdentity.ts';

export const WAVE_PREFERENCES_KEY = 'soso:wave-preferences:v1';
export const WAVE_SESSION_IDLE_MS = 30 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};
type Anchor = { track: Track; score: number; positives: number; explicit: boolean; at: number };
type Observation = { id: string; reaction: number; novel: boolean };
type Metrics = {
  observations: number;
  earlySkips: number;
  successfulListens: number;
  liked: number;
  discoveries: number;
};

/** Learn locally from explicit reactions and measured listening; never store streams or artwork. */
export function createWavePreferences(storage?: StorageLike, now: () => number = Date.now) {
  if (!storage) {
    try {
      if (typeof localStorage !== 'undefined') storage = localStorage;
    } catch {
      /* Session-only fallback. */
    }
  }
  let anchors: Anchor[] = [],
    observations: Observation[] = [],
    activityAt = now();
  let metrics: Metrics = {
    observations: 0,
    earlySkips: 0,
    successfulListens: 0,
    liked: 0,
    discoveries: 0,
  };
  const strength = (anchor: Anchor) =>
    anchor.score * 0.5 ** (Math.max(0, now() - anchor.at) / (30 * DAY));
  const prune = () => {
    anchors = anchors
      .filter((anchor) => now() - anchor.at <= 90 * DAY && strength(anchor) >= 0.05)
      .sort((a, b) => strength(b) - strength(a))
      .slice(0, 96);
  };
  try {
    const raw = storage?.getItem(WAVE_PREFERENCES_KEY);
    const saved = raw && raw.length < 256000 ? JSON.parse(raw) : null;
    if (saved?.version === 1 && Array.isArray(saved.anchors)) {
      for (const item of saved.anchors.slice(0, 96)) {
        const track = waveMemoryTrack(item?.track);
        if (
          !track ||
          !Number.isFinite(item.score) ||
          item.score <= 0 ||
          !Number.isFinite(item.at) ||
          item.at > now() + 60000
        )
          continue;
        const positives = Number.isFinite(item.positives)
          ? Math.max(0, Math.min(100, Math.floor(item.positives)))
          : 0;
        if (anchors.some((anchor) => String(anchor.track.id) === String(track.id))) continue;
        anchors.push({
          track,
          score: Math.min(4, item.score),
          positives,
          explicit: item.explicit === true,
          at: item.at,
        });
      }
      for (const key of Object.keys(metrics) as (keyof Metrics)[]) {
        const value = saved.metrics?.[key];
        if (Number.isFinite(value)) metrics[key] = Math.max(0, Math.min(1e9, Math.floor(value)));
      }
    }
  } catch {
    /* Corrupt storage must not affect playback. */
  }
  prune();

  const touchSession = () => {
    const stamp = now(),
      stale = stamp - activityAt >= WAVE_SESSION_IDLE_MS;
    if (stale) observations = [];
    activityAt = stamp;
    return stale;
  };
  const save = () => {
    prune();
    try {
      storage?.setItem(WAVE_PREFERENCES_KEY, JSON.stringify({ version: 1, anchors, metrics }));
    } catch {
      /* Full/disabled storage retains in-memory learning. */
    }
  };
  return {
    touchSession,
    learnedTracks(): Track[] {
      prune();
      const artists = new Map<string, number>(),
        result: Track[] = [];
      const evidence = anchors.filter((anchor) => strength(anchor) >= 0.15);
      const styleCounts = new Map<string, number>(),
        artistCounts = new Map<string, number>();
      const profiles = new Map(evidence.map((anchor) => [anchor, waveMusicProfile(anchor.track)]));
      for (const anchor of evidence) {
        for (const style of profiles.get(anchor)!.styles)
          styleCounts.set(style, (styleCounts.get(style) || 0) + 1);
        const artist = getWaveArtistKeys(anchor.track)[0] || '';
        if (artist) artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
      }
      for (const anchor of evidence) {
        // Independent successful songs can corroborate a style without requiring song repeats.
        const mainArtist = getWaveArtistKeys(anchor.track)[0] || '';
        const corroborated =
          [...profiles.get(anchor)!.styles].some((style) => (styleCounts.get(style) || 0) >= 2) ||
          (mainArtist && (artistCounts.get(mainArtist) || 0) >= 2);
        if (!anchor.explicit && anchor.positives < 2 && !corroborated) continue;
        const artist = getWaveArtistKeys(anchor.track)[0] || '';
        if (artist && (artists.get(artist) || 0) >= 2) continue;
        result.push(anchor.track);
        if (artist) artists.set(artist, (artists.get(artist) || 0) + 1);
        if (result.length >= 48) break;
      }
      return result;
    },
    record(
      value: Track,
      reaction: number,
      novel: boolean,
      kind: 'listen' | 'like' | 'dislike' = 'listen',
    ) {
      if (!Number.isFinite(reaction) || !reaction) return;
      const track = waveMemoryTrack(value);
      if (!track) return;
      touchSession();
      const bounded = Math.max(-1, Math.min(1, reaction)),
        id = String(track.id);
      // Repeated signals on one song update its evidence instead of faking multiple discoveries.
      const alreadyAccepted = observations.some((item) => item.id === id && item.reaction > 0);
      observations = [
        ...observations.filter((item) => item.id !== id),
        { id, reaction: bounded, novel },
      ].slice(-16);
      const previous = anchors.find((anchor) => String(anchor.track.id) === id);
      if (bounded > 0) {
        const score = Math.min(4, (previous ? strength(previous) : 0) + bounded);
        anchors = [
          ...anchors.filter((anchor) => String(anchor.track.id) !== id),
          {
            track,
            score,
            positives: Math.min(100, (previous?.positives || 0) + 1),
            explicit: kind === 'like' || previous?.explicit === true,
            at: now(),
          },
        ];
      } else if (previous) {
        // Negative implicit feedback fades an existing affinity, never creates a durable genre ban.
        previous.score = Math.max(
          0,
          strength(previous) + bounded * (kind === 'dislike' ? 1 : 0.25),
        );
        previous.at = now();
        if (kind === 'dislike') previous.explicit = false;
      }
      metrics.observations++;
      if (bounded < 0 && kind === 'listen') metrics.earlySkips++;
      if (bounded > 0 && kind === 'listen') metrics.successfulListens++;
      if (kind === 'like') metrics.liked++;
      if (bounded > 0 && novel && !alreadyAccepted) metrics.discoveries++;
      save();
    },
    discoveryAdjustment(): number {
      const novel = observations.filter((item) => item.novel);
      // One or two unfamiliar songs are not enough evidence to change the station.
      if (novel.length < 3) return 0;
      let total = 0,
        weight = 0;
      for (let index = 0; index < observations.length; index++) {
        const observation = observations[observations.length - 1 - index];
        if (!observation.novel) continue;
        const recency = 0.86 ** index;
        const confidence =
          observation.reaction > 0
            ? Math.min(1.5, 0.7 + observation.reaction)
            : Math.min(1.5, 0.4 + Math.abs(observation.reaction));
        total += Math.sign(observation.reaction) * confidence * recency;
        weight += confidence * recency;
      }
      return Math.max(-0.2, Math.min(0.2, (total / (weight + 3)) * 0.3));
    },
    metrics(): Readonly<Metrics> {
      return { ...metrics };
    },
  };
}
