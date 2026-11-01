import { encodeSongs, numericNames } from './songPacket.ts';
import { runRustCompute } from './rustCore.ts';
import type { WaveSongIdentity } from '../utils/waveIdentity.ts';

/** Transport only: Rust owns blocking, negative weights, duplicate checks and artist diversity. */
export function dailyDecision(
  operation: 'daily_select' | 'daily_rejections' | 'daily_accepts',
  candidates: readonly { id: string; song: WaveSongIdentity; unavailable?: boolean }[],
  known: readonly { id: string; song: WaveSongIdentity }[],
  disliked: readonly { id: string; song: WaveSongIdentity }[],
  preserve = 0,
): number[] {
  const songs = encodeSongs(
    candidates.map((t) => t.song),
    known.map((t) => t.song),
    disliked.map((t) => t.song),
  );
  const ids = numericNames();
  const words = [...candidates, ...known, ...disliked].map((t) => ids.id(t.id));
  words.push(
    ...candidates.map((t) => Number(!!t.unavailable)),
    Math.min(candidates.length, Math.max(0, preserve)),
  );
  const bytes = new Uint8Array(4 + songs.length + words.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, songs.length, true);
  bytes.set(songs, 4);
  words.forEach((v, i) => view.setUint32(4 + songs.length + i * 4, v, true));
  const result = runRustCompute(operation, bytes);
  const output = new DataView(result.buffer, result.byteOffset, result.length);
  if (result.length % 4) throw Error('Invalid Rust daily result');
  const values = Array.from({ length: result.length / 4 }, (_, i) => output.getUint32(i * 4, true));
  if (operation === 'daily_rejections') {
    if (values.length !== candidates.length || values.some((v) => v > 2))
      throw Error('Invalid Rust daily counts');
  } else if (
    values.length > 5 ||
    values.some((i) => i >= candidates.length) ||
    new Set(values).size !== values.length
  ) {
    throw Error('Invalid Rust daily indices');
  }
  return values;
}
