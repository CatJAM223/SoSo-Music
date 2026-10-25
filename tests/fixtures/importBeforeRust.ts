// Historical import scorer, only for parity/benchmarks. Never imported by production.
import type { Track, Playlist } from '../../src/shared/types/index.ts';
import type {
  ExternalPlaylist,
  ExternalPlaylistTrack,
  ImportMatch,
  ImportSearchSource,
} from '../../src/shared/types/playlistImport.ts';
import { extractCoreTitle } from '../../src/shared/utils/trackFingerprint.ts';
import { getWaveArtistNames, matchesWaveArtist } from '../../src/shared/utils/waveIdentity.ts';
import { PlaybackLogger } from '../../src/shared/services/playbackLogger.ts';

export type ImportSearch = (
  query: string,
  limit: number,
  source: ImportSearchSource,
) => Promise<{ data: Track[] }>;
const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const variants = (title: string) => {
  const words = normalize(title)
    .replace(/ремикс/g, 'remix')
    .replace(/speed\s*up|sped\s*up|speedup/g, 'sped')
    .replace(/кавер/g, 'cover')
    .replace(/караоке/g, 'karaoke')
    .replace(/акустик\w*/g, 'acoustic');
  return new Set(
    words
      .split(' ')
      .filter((word) =>
        [
          'remix',
          'bootleg',
          'live',
          'acoustic',
          'cover',
          'instrumental',
          'karaoke',
          'slowed',
          'sped',
          'nightcore',
          'reverb',
          'mashup',
          'минусовка',
          'extended',
          'tour',
        ].includes(word),
      ),
  );
};
const titleCore = (title: string, artists: string[]) => {
  let core = normalize(
    extractCoreTitle(title.normalize('NFKC').replace(/([\p{L}\p{N}]*)\*+/gu, '$1masktoken')),
  );
  for (const artist of artists.map(normalize).sort((a, b) => b.length - a.length)) {
    if (artist)
      core = (' ' + core + ' ')
        .split(' ' + artist + ' ')
        .join(' ')
        .trim();
  }
  return core;
};
const tokenMatches = (wanted: string, actual: string) =>
  wanted === actual ||
  (wanted.endsWith('masktoken') && wanted.length >= 11 && actual.startsWith(wanted.slice(0, -9))) ||
  (actual.endsWith('masktoken') && actual.length >= 11 && wanted.startsWith(actual.slice(0, -9)));

export function scoreImportCandidate(
  original: ExternalPlaylistTrack,
  candidate: Track,
): { score: number; confident: boolean } {
  if (
    !candidate?.title ||
    !candidate.id ||
    !candidate.artist?.name ||
    candidate.playbackUnavailable ||
    !['soundcloud', 'youtube'].includes(candidate.source || '')
  )
    return { score: 0, confident: false };
  const targetVariants = variants(original.title);
  const candidateVariants = variants(candidate.title);
  if (
    targetVariants.size !== candidateVariants.size ||
    [...targetVariants].some((v) => !candidateVariants.has(v))
  )
    return { score: 0, confident: false };
  const originalArtists = getWaveArtistNames(original.artist);
  const artist = normalize(originalArtists[0] || '');
  const candidateArtist = normalize(candidate.artist.name.replace(/\s*[-–—]?\s*Topic$/i, ''));
  const creditNames = [...originalArtists, ...getWaveArtistNames(candidate)];
  const title = titleCore(candidate.title, creditNames);
  const expected = titleCore(original.title, originalArtists);
  if (!expected || !artist) return { score: 0, confident: false };
  const artistMatches =
    candidateArtist === artist || matchesWaveArtist(candidate, originalArtists[0]);
  if (!artistMatches) return { score: 0, confident: false };
  const wanted = new Set(expected.split(' ').filter(Boolean));
  const actual = new Set(title.split(' ').filter(Boolean));
  const common = [...wanted].filter((token) =>
    [...actual].some((other) => tokenMatches(token, other)),
  ).length;
  const recall = common / wanted.size;
  const precision = common / Math.max(1, actual.size);
  if (recall < 0.6 || precision < 0.5) return { score: 0, confident: false };
  const shortOriginal = original.duration > 0 && original.duration < 15;
  const durationKnown = original.duration >= 15 && candidate.duration > 0;
  const difference = durationKnown ? Math.abs(original.duration - candidate.duration) : 0;
  if (durationKnown && original.duration > 60 && candidate.duration <= 35)
    return { score: 0, confident: false };
  if (durationKnown && difference > Math.max(20, original.duration * 0.1) && recall < 0.95)
    return { score: 0, confident: false };
  const exact = title === expected;
  const masked = expected.includes('masktoken') || title.includes('masktoken');
  const confident =
    !shortOriginal &&
    (!masked || exact) &&
    (exact || (recall >= 0.95 && precision >= 0.9)) &&
    (!durationKnown || difference <= 8);
  return {
    score:
      recall * 45 +
      precision * 30 +
      (candidateArtist === artist ? 15 : 8) +
      (durationKnown ? Math.max(0, 10 - difference) : 3),
    confident,
  };
}
