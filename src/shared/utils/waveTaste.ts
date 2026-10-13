import { waveSeedArtwork } from './trackArtwork.ts';
import { waveMusicMetadata } from './waveMusicProfile.ts';
import type { Track } from '../types/index.ts';
import { normalizeWaveSeed } from './waveRecommendations.ts';
import { getWaveArtistKeys } from './waveIdentity.ts';

/** Playlists express intent, but less strongly than likes or successful listening. */
export function selectPlaylistWaveSeeds(
  rows: readonly any[],
  excluded: ReadonlySet<string> = new Set(),
  limit = 6,
  random: () => number = Math.random,
): Track[] {
  const groups = new Map<string, Track[]>();
  for (const row of rows) {
    const track = normalizeWaveSeed(row);
    if (
      !track ||
      !track.title ||
      !track.artist.name ||
      track.playbackUnavailable ||
      excluded.has(String(track.id))
    )
      continue;
    const playlist = String(row.playlist_id || 'library');
    const group = groups.get(playlist) || [];
    group.push(track);
    groups.set(playlist, group);
  }
  const shuffled = <T>(items: T[]) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const pools = shuffled([...groups.values()]).map(shuffled);
  const selected: Track[] = [],
    ids = new Set<string>(),
    artists = new Set<string>();
  while (selected.length < Math.max(0, limit)) {
    let progress = false;
    for (const pool of pools) {
      let candidate: Track | undefined;
      while (pool.length) {
        const next = pool.pop()!;
        const keys = getWaveArtistKeys(next);
        if (!keys.length || ids.has(String(next.id)) || keys.some((key) => artists.has(key)))
          continue;
        candidate = next;
        keys.forEach((key) => artists.add(key));
        break;
      }
      if (!candidate) continue;
      ids.add(String(candidate.id));
      selected.push({
        id: candidate.id,
        title: candidate.title,
        artist: { name: candidate.artist.name },
        album: waveSeedArtwork(candidate),
        preview: '',
        duration: candidate.duration,
        source: candidate.source,
        ...waveMusicMetadata(candidate),
        waveSeedWeight: 0.25,
      });
      progress = true;
      if (selected.length >= limit) break;
    }
    if (!progress) break;
  }
  return selected;
}

export function mergeWaveTasteSeeds(
  primary: readonly any[],
  playlists: readonly any[],
  dislikedIds: readonly (string | number)[],
): Track[] {
  const excluded = new Set(dislikedIds.map(String)),
    artistCounts = new Map<string, number>();
  const strong: Track[] = [];
  for (const row of primary) {
    const track = normalizeWaveSeed(row);
    if (!track || excluded.has(String(track.id)) || track.playbackUnavailable) continue;
    const artists = getWaveArtistKeys(track);
    if (!artists.length || artists.some((key) => (artistCounts.get(key) || 0) >= 2)) continue;
    excluded.add(String(track.id));
    artists.forEach((key) => artistCounts.set(key, (artistCounts.get(key) || 0) + 1));
    strong.push({
      id: track.id,
      title: track.title,
      artist: { name: track.artist.name },
      album: waveSeedArtwork(track),
      preview: '',
      duration: track.duration,
      source: track.source,
      ...waveMusicMetadata(track),
      waveSeedWeight: track.waveSeedWeight === 2 ? 2 : 1,
    });
    if (strong.length >= 48) break;
  }
  const weakLimit = strong.length ? Math.min(6, Math.max(1, Math.floor(strong.length / 3))) : 6;
  return [...strong, ...selectPlaylistWaveSeeds(playlists, excluded, weakLimit)];
}

/** Explicit likes reserve most of the profile; automatic listening cannot crowd them out. */
export function buildWaveTasteSeeds(
  likes: readonly any[],
  session: readonly any[],
  history: readonly any[],
  playlists: readonly any[],
  dislikedIds: readonly (string | number)[],
): Track[] {
  const liked = mergeWaveTasteSeeds(
    likes.map((row) => ({ ...row, waveSeedWeight: 2 })),
    [],
    dislikedIds,
  );
  return mergeWaveTasteSeeds(
    [...liked.slice(0, 32), ...session.slice(0, 8), ...history.slice(0, 8), ...liked.slice(32)],
    playlists,
    dislikedIds,
  );
}

export function waveTasteArtistWeights(seeds: readonly Track[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const seed of seeds)
    for (const key of getWaveArtistKeys(seed)) {
      weights.set(
        key,
        Math.max(
          weights.get(key) || 0,
          seed.waveSeedWeight === 0.25 ? 0.25 : seed.waveSeedWeight === 2 ? 2 : 1,
        ),
      );
    }
  return weights;
}
