import {
  compareWaveSongBatch,
  compareWaveSongs,
  isDistinctiveSongTitle,
} from '../compute/waveSongMatrix.ts';
import { cachedWaveText } from '../compute/waveTextCache.ts';
import type { Track } from '../types/index.ts';
import { extractAllArtists } from './artistParser.ts';
import { buildTrackPrintFromTrack, extractCoreTitle, type TrackPrint } from './trackFingerprint.ts';
import { recordingKey } from '../types/musicDomain.ts';

type WaveTrackLike = { title?: string; artist?: Track['artist'] | string };

/** History is chronological. An equivalent upload inherits the most recent match. */
export function createWaveShowMatcher(
  history: readonly Track[],
  knownArtists: readonly string[] = [],
) {
  const identify = createWaveSongIdentifier([
    ...knownArtists,
    ...history.flatMap(getWaveArtistNames),
  ]);
  const songs = history.map(identify);
  const positions = new Map(history.map((track, index) => [recordingKey(track), index]));
  const pages: { start: number; songs: WaveSongIdentity[] }[] = [];
  for (let end = songs.length; end > 0;) {
    const start = Math.max(0, end - 64);
    pages.push({ start, songs: songs.slice(start, end) });
    end = start;
  }
  return (track: Track, identity?: WaveSongIdentity, membershipOnly = false): number => {
    const keyMatch = positions.get(recordingKey(track)) ?? -1;
    if (!pages.length || (membershipOnly && keyMatch >= 0)) return keyMatch;
    const song = identity ?? identify(track);
    for (const page of pages) {
      if (page.start + page.songs.length - 1 <= keyMatch) break;
      const flags = compareWaveSongBatch(page.songs, song);
      for (let i = flags.length - 1; i >= 0; i--) {
        if (flags[i] & 1) return Math.max(keyMatch, page.start + i);
      }
    }
    return keyMatch;
  };
}

export const normalizeWaveArtist = (name: string): string =>
  cachedWaveText('artist', name, normalizeArtistText);
const normalizeArtistText = (name: string): string =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Keep bands intact, but count every collaborator rather than the credit string. */
export function getWaveArtistNames(trackOrName: WaveTrackLike | string): string[] {
  const input = typeof trackOrName === 'string' ? { artist: trackOrName } : trackOrName;
  const raw = typeof input.artist === 'string' ? input.artist : input.artist?.name || '';
  // A slash inside a name (AC/DC, succubus/club) is not a collaboration separator.
  const protectedRaw = raw.replace(/(\S)\/(?=\S)/g, '$1∕');
  const parsed = extractAllArtists({ ...input, artist: protectedRaw });
  // A bare conjunction can belong to a band's name. Explicit feat./& credits
  // are already parsed above; guessing from "и" changes recording identity.
  const names = parsed;
  const seen = new Set<string>();
  return names
    .map((name) => name.replace(/∕/g, '/').trim())
    .filter((name) => {
      const key = normalizeWaveArtist(name);
      if (!key || key === 'unknown artist' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

interface KnownWaveArtists {
  names: readonly string[];
  keys: string[];
  lookup: Set<string>;
  maxWords: number;
}
const knownArtistIndexes = new WeakMap<readonly string[], KnownWaveArtists>();
const emptyArtistIndex: KnownWaveArtists = { names: [], keys: [], lookup: new Set(), maxWords: 0 };

function knownWaveArtists(names: readonly string[]): KnownWaveArtists {
  if (!names.length) return emptyArtistIndex;
  const cached = knownArtistIndexes.get(names);
  if (
    cached &&
    cached.names.length === names.length &&
    names.every((name, index) => name === cached.names[index])
  )
    return cached;
  const keys = [...new Set(names.map(normalizeWaveArtist).filter(Boolean))];
  const index = {
    names: [...names],
    keys,
    lookup: new Set(keys),
    maxWords: keys.reduce((max, key) => Math.max(max, key.split(' ').length), 0),
  };
  knownArtistIndexes.set(names, index);
  return index;
}

/** Re-uploads often put the credited musician in the title, and uploader in artist. */
export function getWaveArtistKeys(
  track: WaveTrackLike,
  knownArtists: readonly string[] = [],
): string[] {
  const catalog = knownWaveArtists(knownArtists);
  return waveArtistKeys(waveSongFields(track, catalog), catalog);
}

function waveArtistKeys(fields: WaveTrackLike, catalog: KnownWaveArtists): string[] {
  const rawArtist = typeof fields.artist === 'string' ? fields.artist : fields.artist?.name || '';
  const title = fields.title || '';
  const coreTitle = normalizeWaveArtist(cleanWaveSongTitle(title));
  const cleanTitle = title
    .replace(/[(\[][^([)\]]*\bprod\.?[^)\]]*[)\]]/gi, '')
    .replace(/\bprod\.?\s.*$/i, '');
  const normalizedTitle = normalizeWaveArtist(cleanTitle);
  const artistWords = normalizeWaveArtist(rawArtist).split(' ');
  const credits = cleanTitle
    .split(/\s+[-–—+]\s+|(?:^|\s)(?:(?:feat\.?|ft\.?|featuring|with)\s+|w\/\s*)/i)
    .map(normalizeWaveArtist);
  const allowsTitleCredits = !/\bcover\b|кавер/i.test(title);
  const keys = getWaveArtistNames(fields).map(normalizeWaveArtist);
  // Test only possible credits from the text against the index. The size of
  // listening history must not multiply title/artist parsing for every track.
  const addCredit = (key: string) => {
    if (key !== coreTitle && catalog.lookup.has(key) && /\p{L}/u.test(key)) keys.push(key);
  };
  const addCreditEdges = (text: string, exact: boolean, suffix: boolean) => {
    const words = text.split(' ');
    const width = Math.min(catalog.maxWords, words.length - (exact ? 0 : 1));
    for (let size = 1; size <= width; size++) {
      addCredit(words.slice(0, size).join(' '));
      if (suffix) addCredit(words.slice(-size).join(' '));
    }
  };
  if (allowsTitleCredits) {
    addCreditEdges(normalizedTitle, false, false);
    if (credits.length > 1) for (const credit of credits) addCreditEdges(credit, true, true);
  }
  for (let start = 0; start < artistWords.length; start++) {
    for (let size = 1; size <= catalog.maxWords && start + size <= artistWords.length; size++) {
      const key = artistWords.slice(start, start + size).join(' ');
      if (key.length >= 3 && catalog.lookup.has(key)) keys.push(key);
    }
  }
  return [...new Set(keys)];
}

export function matchesWaveArtist(track: WaveTrackLike, artist: string): boolean {
  const keys = getWaveArtistKeys(track, [artist]);
  return getWaveArtistNames(artist).some((name) => keys.includes(normalizeWaveArtist(name)));
}

/** Exclude non-song uploads from automated radio, without affecting normal search. */
export function isWaveNonMusic(track: { title?: string }): boolean {
  return /\b(?:amv|parody|snippet|teaser|trailer|karaoke|reaction|tutorial|type[\s-]*beat|podcast)\b|пароди|сниппет|тизер|караоке|минусовка|реакция|подкаст/i.test(
    track.title || '',
  );
}

export interface WaveSongIdentity {
  print: TrackPrint;
  artists: string[];
}

function cleanWaveSongTitle(raw: string): string {
  return extractCoreTitle(
    raw
      .normalize('NFKC')
      .replace(/([\p{L}\p{N}])['’]s\b/gu, '$1')
      .replace(/[(\[{][\s\S]*?[)\]}]/g, (part) =>
        /remix|bootleg|slowed|sped|speed|nightcore|daycore|reverb|bass\s*boost|alt\s+ver|acoustic|live|cover|кавер|акустик|замедлен|без\s/i.test(
          part,
        )
          ? ' '
          : part,
      )
      .replace(/\s+[-–—|]\s*(?:live|acoustic|cover|кавер|акустик)(?:\s.*)?$/i, '')
      .replace(
        /\b(?:remix|bootleg|slowed|sped[\s-]*up|speed[\s-]*up|speedup|nightcore|daycore|reverb|bass[\s-]*boost(?:ed)?|alt\s+ver(?:sion)?)\b.*$/i,
        '',
      ),
  );
}

function waveSongFields(track: WaveTrackLike, catalog: KnownWaveArtists): WaveTrackLike {
  const artist = typeof track.artist === 'string' ? track.artist : track.artist?.name || '';
  const title = cleanWaveSongTitle(track.title || '');
  // Speed-edit uploaders sometimes reverse the musician and song fields.
  // Infer a swap only with a known artist, a version marker and a substantial
  // song title in the artist field; a song named Nirvana alone is insufficient.
  if (
    title &&
    catalog.lookup.has(title) &&
    title !== normalizeWaveArtist(artist) &&
    /\b(?:slowed|sped[\s-]*up|speed[\s-]*up|speedup|nightcore|daycore|remix|bootleg|acoustic|cover|live)\b|кавер|акустик|замедлен/i.test(
      track.title || '',
    ) &&
    isDistinctiveSongTitle(buildTrackPrintFromTrack({ title: cleanWaveSongTitle(artist) }).tokens)
  ) {
    return { title: artist, artist: title };
  }
  return track;
}

/** A song family is broader than a recording: remix/speed edits share its cooldown. */
export function buildWaveSongIdentity(
  track: WaveTrackLike,
  knownArtists: readonly string[] = [],
): WaveSongIdentity {
  return songIdentity(track, knownWaveArtists(knownArtists));
}

/** One artist index for a synchronous batch, without rechecking the input on each row. */
export function createWaveSongIdentifier(knownArtists: readonly string[]) {
  const catalog = knownWaveArtists(knownArtists);
  return (track: WaveTrackLike) => songIdentity(track, catalog);
}

function songIdentity(track: WaveTrackLike, catalog: KnownWaveArtists): WaveSongIdentity {
  const fields = waveSongFields(track, catalog);
  const artists = waveArtistKeys(waveSongFields(fields, catalog), catalog);
  let title = cleanWaveSongTitle(fields.title || '');
  // Never erase the complete title when an uploader uses the song as their name.
  for (const artist of [...artists].sort((a, b) => b.length - a.length)) {
    const withoutArtist = ` ${title} `.split(` ${artist} `).join(' ').trim();
    if (withoutArtist) title = withoutArtist;
  }
  const print = buildTrackPrintFromTrack({ title, duration: 0 });
  return { print, artists };
}

export function areSameWaveSong(a: WaveSongIdentity, b: WaveSongIdentity): boolean {
  return compareWaveSongs(a, b);
}
