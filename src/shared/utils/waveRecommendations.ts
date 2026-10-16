import { normalizePlaybackOrigin } from './tastePolicy.ts';
import { normalizeWaveSource } from '../services/waveSource.ts';
import { waveMusicMetadata, waveMusicProfile, waveMoodScore } from './waveMusicProfile.ts';
import type { Track, WaveBatchContext, WaveMood } from '../types/index.ts';
import { detectTrackSource } from './formatters.ts';
import { getWaveArtistKeys, getWaveArtistNames, normalizeWaveArtist } from './waveIdentity.ts';
import type { WaveQueueOptions } from './waveQueue.ts';
import { WAVE_HISTORY_LIMIT } from './waveHistoryLimits.ts';

/** Taste storage exposes both provider tracks and database rows. Keep the provider identity. */
export function normalizeWaveSeed(seed: any): Track | null {
  const id = String(seed?.track_deezer_id || seed?.deezer_id || seed?.id || '');
  if (!id || id === 'undefined' || id === 'null') return null;
  const artist = String(
    typeof seed.artist === 'string' ? seed.artist : seed.artist?.name || seed.artist_name || '',
  );
  return {
    ...seed,
    id,
    title: String(seed.title || ''),
    artist: { ...(typeof seed.artist === 'object' ? seed.artist : {}), name: artist },
    album: typeof seed.album === 'object' && seed.album ? seed.album : { title: seed.album || '' },
    preview: seed.preview || seed.preview_url || '',
    duration: Number(seed.duration) || 180,
    source: detectTrackSource({ ...seed, id }),
    ...waveMusicMetadata(seed),
  };
}

/** Bound the new IPC argument and carry musical identity instead of artwork or signed URLs. */
export function normalizeWaveBatchContext(value: unknown): WaveBatchContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as WaveBatchContext;
  const normalizeTracks = (tracks: unknown, limit: number) =>
    (Array.isArray(tracks) ? tracks.slice(-limit) : [])
      .map(normalizeWaveSeed)
      .filter((track): track is Track => Boolean(track))
      .map((track) => ({
        id: String(track.id).slice(0, 128),
        queueOrigin: normalizePlaybackOrigin(track.queueOrigin),
        title: track.title.slice(0, 500),
        artist: { name: track.artist.name.slice(0, 500) },
        album: { title: '' },
        preview: '',
        duration: Number.isFinite(track.duration) ? track.duration : 180,
        source: track.source,
        ...waveMusicMetadata(track),
      }));
  const recentTracks = normalizeTracks(input.recentTracks, WAVE_HISTORY_LIMIT);
  const offeredTracks = normalizeTracks(input.offeredTracks, 80);
  const artistFeedback: Record<string, number> = {};
  const feedback = input.artistFeedback;
  if (feedback && typeof feedback === 'object' && !Array.isArray(feedback)) {
    for (const [artist, value] of Object.entries(feedback).slice(0, 100)) {
      const key = normalizeWaveArtist(artist.slice(0, 500));
      if (key && Number.isFinite(value)) artistFeedback[key] = Math.max(-2, Math.min(2, value));
    }
  }
  return {
    tasteRevision: Number.isSafeInteger(input.tasteRevision) ? input.tasteRevision : undefined,
    source: normalizeWaveSource(input.source),
    recentTracks,
    offeredTracks,
    artistFeedback,
    positiveTracks: normalizeTracks(
      Array.isArray(input.positiveTracks) ? input.positiveTracks.slice(0, 12) : [],
      12,
    ),
    skippedTracks: normalizeTracks(
      Array.isArray(input.skippedTracks) ? input.skippedTracks.slice(0, 12) : [],
      12,
    ),
    learnedTracks: normalizeTracks(
      Array.isArray(input.learnedTracks) ? input.learnedTracks.slice(0, 48) : [],
      48,
    ),
    discoveryAdjustment: Number.isFinite(input.discoveryAdjustment)
      ? Math.max(-0.2, Math.min(0.2, input.discoveryAdjustment!))
      : 0,
  };
}

export function waveQueueContext(context: WaveBatchContext = {}): WaveQueueOptions {
  const feedback = new Map<string, number>();
  for (const [artist, value] of Object.entries(context.artistFeedback || {})) {
    if (Number.isFinite(value)) feedback.set(artist, Math.max(-2, Math.min(2, value)));
  }
  return {
    recentTracks: (context.recentTracks || []).slice(-WAVE_HISTORY_LIMIT),
    offeredTracks: (context.offeredTracks || []).slice(-80),
    artistFeedback: feedback,
    positiveTracks: (context.positiveTracks || []).slice(0, 12),
    skippedTracks: (context.skippedTracks || []).slice(0, 12),
    learnedTracks: (context.learnedTracks || []).slice(0, 48),
    discoveryAdjustment: Number.isFinite(context.discoveryAdjustment)
      ? Math.max(-0.2, Math.min(0.2, context.discoveryAdjustment!))
      : 0,
  };
}

/** A small set of different musical anchors, with both providers represented when available. */
export function selectWaveRelatedSeeds(
  seeds: readonly any[],
  context: WaveBatchContext = {},
  limit = 3,
  random: () => number = Math.random,
  recentAnchorIds: readonly string[] = [],
): Track[] {
  const history = (context.recentTracks || []).slice(-40).map((track) => getWaveArtistKeys(track));
  const exposure = (context.offeredTracks || [])
    .slice(-40)
    .map((track) => getWaveArtistKeys(track));
  const seenIds = new Set<string>();
  const candidates = seeds
    .map(normalizeWaveSeed)
    .filter((track): track is Track => {
      if (!track || track.playbackUnavailable || seenIds.has(String(track.id))) return false;
      const supported =
        track.source === 'youtube'
          ? /^yt_[\w-]{11}$/.test(String(track.id))
          : track.source === 'soundcloud' && /^\d+$/.test(String(track.id).replace(/^sc_/, ''));
      if (!supported) return false;
      seenIds.add(String(track.id));
      return true;
    })
    .map((track, index) => {
      const artists = getWaveArtistKeys(track);
      const fatigue = history.filter((keys) => keys.some((key) => artists.includes(key))).length;
      const offeredFatigue = exposure.filter((keys) =>
        keys.some((key) => artists.includes(key)),
      ).length;
      const feedback = artists.map((artist) => context.artistFeedback?.[artist] || 0);
      const reaction = Math.min(0, ...feedback) || Math.min(1, Math.max(0, ...feedback));
      // Explore near music that worked; a recent negative reaction is a temporary detour.
      const lastUsed = recentAnchorIds.lastIndexOf(String(track.id));
      const cooldown =
        lastUsed < 0 ? 0 : Math.max(0, 6 - (recentAnchorIds.length - 1 - lastUsed) * 0.25);
      return {
        track,
        artists,
        score:
          fatigue * 3 +
          offeredFatigue -
          reaction * 2 +
          cooldown +
          (track.waveSeedWeight === 0.25 ? 1.5 : track.waveSeedWeight === 2 ? -0.75 : 0) +
          Math.min(index, 50) * 0.003 +
          random(),
      };
    })
    .sort((a, b) => a.score - b.score);
  // Repeated skips should redirect discovery itself, not only reorder its eventual songs.
  // Keep a fallback for a tiny profile whose only available artists were recently skipped.
  const preferred = candidates.filter((candidate) =>
    candidate.artists.every((artist) => (context.artistFeedback?.[artist] || 0) > -0.8),
  );
  const eligible = preferred.length ? preferred : candidates;
  const result: Track[] = [];
  const usedArtists = new Set<string>();
  const take = (candidate: (typeof candidates)[number]) => {
    result.push(candidate.track);
    candidate.artists.forEach((artist) => usedArtists.add(artist));
  };
  const capacity = Math.max(0, Math.min(3, Math.floor(limit)));
  if (!capacity) return result;
  for (const candidate of eligible) {
    if (candidate.artists.some((artist) => usedArtists.has(artist))) continue;
    // Reserve the final slot for another available provider without repeating an anchor artist.
    if (
      result.length === capacity - 1 &&
      result.length > 0 &&
      result.every((track) => track.source === candidate.track.source) &&
      eligible.some(
        (other) =>
          other.track.source !== candidate.track.source &&
          !other.artists.some((artist) => usedArtists.has(artist)),
      )
    )
      continue;
    take(candidate);
    if (result.length >= capacity) break;
  }
  return result;
}

/** Keep familiar taste stable when the renderer rearranges an already fetched queue. */
export function waveFamiliarArtists(
  likes: readonly any[],
  followed: readonly any[],
  positives: readonly Track[] = [],
): string[] {
  return [
    ...new Set([
      ...likes.flatMap((seed) => getWaveArtistNames(normalizeWaveSeed(seed) || '')),
      ...followed.flatMap((artist) => getWaveArtistNames(artist?.name || '')),
      ...positives.flatMap(getWaveArtistNames),
    ]),
  ];
}

/** Prefer fitting anchors without guessing a song's mood from the artist's name. */
export function selectWaveMoodSeeds(seeds: readonly Track[], mood: WaveMood): Track[] {
  if (mood !== 'energy' && mood !== 'chill') return [...seeds];
  const ranked = seeds
    .map((track, index) => ({ track, index, score: waveMoodScore(waveMusicProfile(track), mood) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  // Unknown anchors otherwise crowd out the few songs with actual mood evidence.
  const matching = ranked.filter((candidate) => candidate.score > 0);
  if (matching.length) return matching.map((candidate) => candidate.track);
  const suitable = ranked.filter((candidate) => candidate.score >= 0);
  return (suitable.length ? suitable : ranked).map((candidate) => candidate.track);
}
