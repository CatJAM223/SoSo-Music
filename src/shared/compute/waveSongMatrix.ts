import type { WaveSongIdentity } from '../utils/waveIdentity.ts';
import type { TrackPrint } from '../utils/trackFingerprint.ts';
import { encodeSongs } from './songPacket.ts';
import { runRustCompute } from './rustCore.ts';
export { initializeRustCompute } from './rustCore.ts';
export interface WaveSongMatrix {
  wasHeard: (index: number) => boolean;
  wasOffered: (index: number) => boolean;
  sameSong: (left: number, right: number) => boolean;
}
/** Optional batching decision only. Smaller or larger comparisons also execute in Rust. */
export function createWaveSongMatrix(
  candidates: readonly WaveSongIdentity[],
  recent: readonly WaveSongIdentity[],
  offered: readonly WaveSongIdentity[],
): WaveSongMatrix | null {
  const count = candidates.length;
  if (
    count > 4096 ||
    recent.length > 4096 ||
    offered.length > 4096 ||
    count * (count + recent.length + offered.length) < 5000
  )
    return null;
  const flags = runRustCompute('calculate', encodeSongs(candidates, recent, offered));
  if (flags.length !== count * count + 2 * count) throw Error('Invalid Rust song matrix');
  return {
    wasHeard: (i) => flags[i] === 1,
    wasOffered: (i) => flags[count + i] === 1,
    sameSong: (i, j) => flags[2 * count + i * count + j] === 1,
  };
}
export function compareWaveSongs(left: WaveSongIdentity, right: WaveSongIdentity): boolean {
  const flags = runRustCompute('compare_songs', encodeSongs([left, right]));
  if (flags.length !== 1) throw Error('Invalid Rust comparison');
  return (flags[0] & 1) !== 0;
}
export function compareRecordings(left: TrackPrint, right: TrackPrint): boolean {
  const flags = runRustCompute(
    'compare_songs',
    encodeSongs([
      { print: left, artists: [] },
      { print: right, artists: [] },
    ]),
  );
  if (flags.length !== 1) throw Error('Invalid Rust comparison');
  return (flags[0] & 2) !== 0;
}
export interface SongDeduplicator {
  hasDuplicate: (index: number) => boolean;
  accept: (index: number) => void;
}
export function createSongDeduplicator<T>(
  candidates: readonly T[],
  identify: (item: T) => WaveSongIdentity,
): SongDeduplicator {
  const identities = new Map<number, WaveSongIdentity>();
  const at = (i: number) => {
    let value = identities.get(i);
    if (!value) {
      value = identify(candidates[i]);
      identities.set(i, value);
    }
    return value;
  };
  const accepted: number[] = [];
  // Building a full matrix is useful for large result sets; single comparisons use the same Rust core.
  let matrix: WaveSongMatrix | null = null,
    attempted = false,
    comparisons = 0;
  let pending: number | undefined;
  return {
    hasDuplicate(index) {
      if (pending !== undefined) {
        identities.delete(pending);
        pending = undefined;
      }
      if (
        !attempted &&
        candidates.length <= 4096 &&
        comparisons >= 5000 &&
        (candidates.length - index) * accepted.length >= 5000
      ) {
        attempted = true;
        matrix = createWaveSongMatrix(
          candidates.map((_, i) => at(i)),
          [],
          [],
        );
        if (matrix) identities.clear();
      }
      if (matrix) return accepted.some((i) => matrix!.sameSong(i, index));
      const song = at(index);
      pending = index;
      return accepted.some((i) => {
        comparisons++;
        return compareWaveSongs(at(i), song);
      });
    },
    accept(index) {
      accepted.push(index);
      if (pending === index) pending = undefined;
    },
  };
}

/** The substantial-title rule is also owned by Rust, including metadata swap checks. */
export function isDistinctiveSongTitle(tokens: readonly string[]): boolean {
  const empty = { tokens: [], set: new Set<string>(), variants: new Set<string>(), dur: 0 };
  const print = { ...empty, tokens: [...tokens] };
  const flags = runRustCompute(
    'compare_songs',
    encodeSongs([
      { print, artists: [] },
      { print: empty, artists: [] },
    ]),
  );
  if (flags.length !== 1) throw Error('Invalid Rust title classification');
  return (flags[0] & 4) !== 0;
}
