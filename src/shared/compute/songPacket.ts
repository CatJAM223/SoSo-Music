import type { WaveSongIdentity } from '../utils/waveIdentity.ts';
import { MAX_COMPUTE_INPUT } from './rustCore.ts';
export interface NumericNames {
  ids: Map<string, number>;
  id: (name: string) => number;
}
export function numericNames(): NumericNames {
  const ids = new Map<string, number>();
  return {
    ids,
    id(name) {
      let id = ids.get(name);
      if (id === undefined) {
        id = ids.size;
        if (id >= 65536) throw Error('Too many compute identifiers');
        ids.set(name, id);
      }
      return id;
    },
  };
}
/** UTF-16 encoding preserves JavaScript string units; all matching happens in Rust. */
export function encodeSongs(
  candidates: readonly WaveSongIdentity[],
  recent: readonly WaveSongIdentity[] = [],
  offered: readonly WaveSongIdentity[] = [],
  artists = numericNames(),
): Uint8Array<ArrayBuffer> {
  if (candidates.length > 8192 || recent.length > 4096 || offered.length > 4096)
    throw Error('Too many songs in compute packet');
  const tokens: string[] = [],
    tokenIds = numericNames(),
    variants = numericNames();
  let units = 0;
  const rows: number[] = [];
  const float = new DataView(new ArrayBuffer(8));
  for (const song of [...candidates, ...recent, ...offered]) {
    if (
      song.print.tokens.length > 128 ||
      song.artists.length > 64 ||
      song.print.variants.size > 64 ||
      !Number.isFinite(song.print.dur)
    )
      throw Error('Unsupported song identity');
    const ids = song.print.tokens.map((t) => {
      if (t.length > 1024) throw Error('Song token exceeds compute limit');
      let id = tokenIds.ids.get(t);
      if (id === undefined) {
        id = tokenIds.id(t);
        tokens.push(t);
        units += t.length;
      }
      return id;
    });
    float.setFloat64(0, song.print.dur, true);
    rows.push(
      ids.length,
      song.artists.length,
      song.print.variants.size,
      float.getUint32(0, true),
      float.getUint32(4, true),
      ...ids,
      ...song.artists.map(artists.id),
      ...[...song.print.variants].map(variants.id),
    );
  }
  if (units > 1048576) throw Error('Song text exceeds compute limit');
  const words = [0x534f534f, 2, candidates.length, recent.length, offered.length, tokens.length];
  for (const token of tokens) {
    words.push(token.length, Number(/\p{N}/u.test(token)));
    for (let i = 0; i < token.length; i++) words.push(token.charCodeAt(i));
  }
  const view = new DataView(new ArrayBuffer((words.length + rows.length) * 4));
  if (view.byteLength > MAX_COMPUTE_INPUT) throw Error('Song packet exceeds compute limit');
  let offset = 0;
  for (const word of words) {
    view.setUint32(offset, word, true);
    offset += 4;
  }
  for (const word of rows) {
    view.setUint32(offset, word, true);
    offset += 4;
  }
  return new Uint8Array(view.buffer);
}
export function encodeNumbers(values: readonly number[]): Uint8Array<ArrayBuffer> {
  const view = new DataView(new ArrayBuffer(values.length * 8));
  values.forEach((value, i) => view.setFloat64(i * 8, value, true));
  return new Uint8Array(view.buffer);
}
