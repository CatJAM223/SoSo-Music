import type { Track } from '../types/index.ts';
import { isArtistMatch, isTitleMatch } from './artistParser.ts';
import { encodeNumbers, numericNames } from '../compute/songPacket.ts';
import { runRustCompute } from '../compute/rustCore.ts';

// Text predicates retain the shared JavaScript normalization and RegExp semantics.
// Scoring, penalty application, deduplication and ordering live in Rust.
const noise = [
  /(\b\d+\s*hours?\b|\b1\s*hour\b|\b10\s*hours\b|\bloop\b)/i,
  /(\bpodcast\b|\breaction\b|\bvoiceover\b|\bskit\b|\bmeme\b)/i,
  /(\bkaraoke\b|\bкараоке\b|\bbacking track\b|\btype beat\b|\bминусовка\b|\bминус\b)/i,
  /(\bbass boosted\b|\bnightcore\b|\bslowed\s*\+\s*reverb\b|\bsped up\b)/i,
  /(\bmashup\b|\bмешап\b|\bmedley\b|\bmegamix\b|\bsuper mix\b|\bultimate mix\b)/i,
  /(\bbootleg\b|\bfan.?made\b|\bfan edit\b|\btribute\b|\bunofficial\b|\bunauthorized\b)/i,
  /(\bcover version\b|\bкавер\b|\bкавер-версия\b|\bcovers\b|\(cover\)|\[cover\])/i,
  /\bprod\.?\s+by\b|\bprod\.\s*[A-Za-zА-ЯёА-яё]/i,
];
const exemptions = [
  ['hour', 'loop'],
  ['podcast', 'reaction'],
  ['karaoke', 'караоке', 'type beat', 'instrumental', 'минус'],
  ['bass boosted', 'nightcore', 'slowed', 'reverb', 'speed'],
  ['mashup', 'мешап', 'medley', 'megamix'],
  ['bootleg', 'fan', 'tribute', 'unofficial'],
  ['cover', 'кавер'],
  ['prod.', 'prod '],
  ['mix', 'set', 'full album'],
];
export function rankSearchTracks(tracks: Track[], query: string): Track[] {
  if (!tracks.length) return [];
  if (tracks.length > 65536) throw Error('Search compute limit exceeded');
  const q = query.toLowerCase().trim();
  const tokens = q.split(/\s+/).filter(Boolean);
  const delimiter = query.match(/\s*[-—–:]\s*/);
  const artistPart = delimiter ? query.substring(0, delimiter.index).trim().toLowerCase() : '';
  const titlePart = delimiter
    ? query
        .substring(delimiter.index! + delimiter[0].length)
        .trim()
        .toLowerCase()
    : '';
  const split = Boolean(artistPart && titlePart);
  const exempt = exemptions.reduce(
    (mask, words, index) => mask | (words.some((word) => q.includes(word)) ? 1 << index : 0),
    0,
  );
  const names = numericNames();
  const artistMatches = new Map<string, [boolean, boolean]>();
  const titles = new Map<string, { lower: string; key: string; junk: number; featured: boolean }>();
  const artists = new Map<string, { lower: string; key: string }>();
  const words: number[] = [1397900104, 1, tracks.length, Number(split), exempt];
  for (const track of tracks) {
    const rawTitle = track.title || '';
    let titleData = titles.get(rawTitle);
    if (!titleData) {
      const lower = rawTitle.toLowerCase();
      titleData = {
        lower: lower.trim(),
        key: lower.replace(/[^a-z0-9а-яё]/gi, ''),
        junk: noise.reduce(
          (mask, pattern, index) => mask | (pattern.test(lower.trim()) ? 1 << index : 0),
          0,
        ),
        featured: (lower.trim().match(/\b(ft\.?|feat\.?|featuring)\b/gi) || []).length >= 3,
      };
      titles.set(rawTitle, titleData);
    }
    const rawArtist = (typeof track.artist === 'object' ? track.artist?.name : track.artist) || '';
    let artistData = artists.get(rawArtist);
    if (!artistData) {
      const lower = rawArtist.toLowerCase();
      artistData = { lower: lower.trim(), key: lower.replace(/[^a-z0-9а-яё]/gi, '') };
      artists.set(rawArtist, artistData);
    }
    const title = titleData.lower;
    const artist = artistData.lower;
    const album = (track.album?.title || '').toLowerCase().trim();
    let flags = 0;
    if (split) {
      let matches = artistMatches.get(artist);
      if (!matches) {
        matches = [
          isArtistMatch(artist, artistPart) || artist.includes(artistPart),
          isArtistMatch(artist, titlePart) || artist.includes(titlePart),
        ];
        artistMatches.set(artist, matches);
      }
      if (
        (matches[0] && (isTitleMatch(title, titlePart) || title.includes(titlePart))) ||
        (matches[1] && (isTitleMatch(title, artistPart) || title.includes(artistPart)))
      )
        flags |= 1;
      if (
        (artist === artistPart && title === titlePart) ||
        (artist === titlePart && title === artistPart)
      )
        flags |= 2;
      if (matches[0] || matches[1]) flags |= 4;
      if (title.includes(artistPart) && title.includes(titlePart)) flags |= 8;
    }
    if (
      [
        `${artist} - ${title}`,
        `${title} - ${artist}`,
        `${artist} ${title}`,
        `${title} ${artist}`,
      ].includes(q)
    )
      flags |= 16;
    if (title === q || artist === q) flags |= 32;
    if (title.startsWith(q) || artist.startsWith(q)) flags |= 64;
    if (title.includes(q) || artist.includes(q)) flags |= 128;
    if (
      track.album?.title &&
      track.album.title !== 'Single' &&
      track.album.title !== 'Unknown Album'
    )
      flags |= 256;
    if (titleData.featured) flags |= 512;
    const matched = tokens.filter(
      (token) => title.includes(token) || artist.includes(token) || album.includes(token),
    ).length;
    const features =
      (track.source === 'youtube' ? 1 : track.source === 'soundcloud' ? 2 : 0) |
      ((track as Track & { user?: { verified?: boolean } }).user?.verified ? 4 : 0);
    const duration = track.duration || 0;
    const identity = `${titleData.key}_${artistData.key}`;
    words.push(
      flags,
      matched,
      tokens.length,
      titleData.junk,
      features,
      Number.isFinite(duration) ? duration : duration > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE,
      names.id(identity),
    );
  }
  const result = runRustCompute('rank_search', encodeNumbers(words));
  if (result.length % 4 || result.length > tracks.length * 4)
    throw Error('Invalid Rust search result');
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  return Array.from({ length: result.length / 4 }, (_, i) => {
    const index = view.getUint32(i * 4, true);
    if (index >= tracks.length) throw Error('Invalid Rust search index');
    return tracks[index];
  });
}
