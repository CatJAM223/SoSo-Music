import { cachedWaveText } from '../compute/waveTextCache.ts';
/**
 * Fuzzy track fingerprinting for cross-source duplicate detection.
 * Catches the same recording re-uploaded under different artist/title metadata
 * (e.g. SoundCloud re-uploads: "Artist - Song" vs bare "Song" by another uploader).
 *
 * Strategy: title-token overlap (containment-aware, typo-tolerant) + duration
 * proximity guard. Artist names are deliberately ignored — differing uploaders
 * are exactly the case being solved.
 */

const NOISE_KEYWORDS = [
  'feat',
  'ft',
  'featuring',
  'prod',
  'produced',
  'official',
  'video',
  'audio',
  'lyric',
  'lyrics',
  'text',
  'hd',
  'hq',
  '4k',
  'remaster',
  'remastered',
  'version',
  'edit',
  'edition',
  'deluxe',
  'radio',
  'single',
  'visualizer',
  'performance',
  'mv',
  'pv',
  'премьера',
  'перевод',
  'озвучка',
];

// Variant markers make a recording genuinely different audio (remix, live, etc.)
// — two tracks must agree on which variants they carry to be duplicates.
const VARIANT_KEYWORDS = [
  'remix',
  'bootleg',
  'flip',
  'slowed',
  'sped',
  'speed',
  'speedup',
  'nightcore',
  'daycore',
  'reverb',
  'live',
  'acoustic',
  'cover',
  'кавер',
  'instrumental',
  'mashup',
  'parody',
  'tribute',
  'extended',
];

export interface TrackPrint {
  tokens: string[]; // ordered tokens of cleaned title
  set: Set<string>;
  variants: Set<string>; // detected variant markers
  dur: number; // seconds, 0 if unknown
}

const cleanSegment = (s: string): string =>
  (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function isNoiseSegment(s: string): boolean {
  const c = cleanSegment(s);
  if (!c) return true;
  return NOISE_KEYWORDS.some((k) => new RegExp(`(^|\\s)${k}(\\s|$)`).test(c));
}

/** Extracts the core song title: strips bracketed metadata and trailing noise suffixes. */
export function extractCoreTitle(rawTitle: string): string {
  return cachedWaveText('title', rawTitle || '', extractUncachedCoreTitle);
}

function extractUncachedCoreTitle(rawTitle: string): string {
  let t = rawTitle || '';
  let prev: string;
  do {
    prev = t;
    t = t.replace(/[(\[{]([^)\]}]*)[)\]}]/g, (m, inner: string) =>
      isNoiseSegment(inner) ? ' ' : m,
    );
  } while (t !== prev);

  // Trailing separator + metadata suffixes: "- Official Audio", "| Lyrics", etc.
  t = t.replace(
    /\s[-–—|]\s*(official|video|audio|lyrics?|visualizer|hd|hq|4k|remaster\w*|premiere|премьера).*$/gi,
    '',
  );

  return cleanSegment(t);
}

function tokenize(core: string): string[] {
  return core
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => /^\d+$/.test(w) || w.length >= 2);
}

function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let curr = i;
    let best = curr;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, curr + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      curr = tmp;
      best = Math.min(best, prev[j]);
    }
    if (best > max) return max + 1;
  }
  return prev[b.length];
}

function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const maxDist = a.length >= 8 ? 2 : a.length >= 4 ? 1 : 0;
  return maxDist > 0 && levenshtein(a, b, maxDist) <= maxDist;
}

function countOverlappingTokens(small: TrackPrint, large: TrackPrint): number {
  let inter = 0;
  for (const tok of small.tokens) {
    if (large.set.has(tok)) {
      inter++;
      continue;
    }
    if (tok.length >= 4 && large.tokens.some((t) => tokensMatch(tok, t))) inter++;
  }
  return inter;
}

/** Builds a comparable print from any track-like object (artist may be object or string). */
export function buildTrackPrintFromTrack(track: any): TrackPrint {
  const title = track?.title || track?.name || '';
  const dur = Math.round(Number(track?.duration) || 0);
  const tokens = tokenize(extractCoreTitle(title));
  const variants = new Set<string>(tokens.filter((tok) => VARIANT_KEYWORDS.includes(tok)));
  return { tokens, set: new Set(tokens), variants, dur };
}

/**
 * Duplicate if titles overlap heavily (containment-aware, typo-tolerant) AND
 * recordings are of similar length. The duration guard prevents merging
 * different songs that merely share a title.
 */
export function areTracksDuplicates(a: TrackPrint, b: TrackPrint): boolean {
  if (!a.tokens.length || !b.tokens.length) return false;

  if (a.dur > 0 && b.dur > 0 && Math.abs(a.dur - b.dur) > 8) return false;

  // Different variant sets (original vs remix/live/acoustic...) = different recordings
  if (a.variants.size !== b.variants.size) return false;
  for (const v of a.variants) {
    if (!b.variants.has(v)) return false;
  }

  const [small, large] = a.tokens.length <= b.tokens.length ? [a, b] : [b, a];
  const inter = countOverlappingTokens(small, large);
  if (inter === 0) return false;

  const coeff = inter / small.tokens.length;

  if (coeff >= 0.99) return true;
  if (coeff >= 0.75 && small.tokens.length >= 3) return true;

  return false;
}
