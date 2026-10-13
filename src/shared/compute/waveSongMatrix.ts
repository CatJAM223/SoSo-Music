import type { WaveSongIdentity } from '../utils/waveIdentity.ts';
import { logger } from '../utils/logger.ts';

interface ComputeExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  abi_version: () => number;
  reserve: (length: number) => number;
  calculate: (length: number) => number;
  output_ptr: () => number;
}
interface PackedToken {
  units: number[];
  numeric: boolean;
}
interface PackedSong {
  tokens: number[];
  artists: number[];
  variants: number[];
  duration: number;
}
export interface WaveSongMatrix {
  wasHeard: (index: number) => boolean;
  wasOffered: (index: number) => boolean;
  sameSong: (left: number, right: number) => boolean;
}
const MAX_INPUT = 2 * 1024 * 1024;
let core: ComputeExports | null = null;
let initialization: Promise<boolean> | null = null;
let warned = false;
function unavailable(): void {
  if (warned) return;
  warned = true;
  logger.warn('[Compute:Rust] Song matching unavailable; using JavaScript');
}

/** Platform bootstrap passes local packaged bytes; no remote code is loaded. */
export function initializeRustCompute(bytes: BufferSource): Promise<boolean> {
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      const result = await WebAssembly.instantiate(bytes, {});
      const exports = result.instance.exports as ComputeExports;
      if (
        exports.abi_version?.() !== 2 ||
        !(exports.memory instanceof WebAssembly.Memory) ||
        typeof exports.reserve !== 'function' ||
        typeof exports.calculate !== 'function' ||
        typeof exports.output_ptr !== 'function'
      )
        throw Error('Unsupported compute ABI');
      core = exports;
      logger.info('[Compute:Rust] Local song matcher ready (ABI 2, memory limit 16 MiB)');
      return true;
    } catch {
      core = null;
      unavailable();
      return false;
    }
  })();
  return initialization;
}

/** One bounded transfer per batch. Unicode parsing stays with the JS reference. */
export function createWaveSongMatrix(
  candidates: readonly WaveSongIdentity[],
  recent: readonly WaveSongIdentity[],
  offered: readonly WaveSongIdentity[],
): WaveSongMatrix | null {
  const count = candidates.length;
  if (
    !core ||
    count > 1000 ||
    recent.length > 300 ||
    offered.length > 80 ||
    count * (count + recent.length + offered.length) < 5000
  )
    return null;
  let packedUnits = 0;
  let supported = true;
  const tokens: PackedToken[] = [],
    tokenIds = new Map<string, number>(),
    artistIds = new Map<string, number>(),
    variantIds = new Map<string, number>();
  const intern = (map: Map<string, number>, value: string) => {
    let id = map.get(value);
    if (id === undefined) {
      id = map.size;
      map.set(value, id);
    }
    return id;
  };
  const packToken = (value: string) => {
    let id = tokenIds.get(value);
    if (id === undefined) {
      if (!supported || tokens.length >= 8192 || packedUnits + value.length > 262144) {
        supported = false;
        return 0;
      }
      packedUnits += value.length;
      id = tokenIds.size;
      tokenIds.set(value, id);
      tokens.push({
        units: Array.from({ length: value.length }, (_, index) => value.charCodeAt(index)),
        numeric: /\p{N}/u.test(value),
      });
    }
    return id;
  };
  const pack = (song: WaveSongIdentity): PackedSong => {
    if (
      !supported ||
      song.print.tokens.length > 64 ||
      song.artists.length > 32 ||
      song.print.variants.size > 32 ||
      !Number.isFinite(song.print.dur) ||
      song.print.tokens.some((token) => token.length > 1024)
    ) {
      supported = false;
      return { tokens: [], artists: [], variants: [], duration: 0 };
    }
    return {
      tokens: song.print.tokens.map(packToken),
      artists: song.artists.map((artist) => intern(artistIds, artist)),
      variants: [...song.print.variants].map((variant) => intern(variantIds, variant)),
      duration: song.print.dur,
    };
  };
  try {
    const job = {
      candidates: candidates.map(pack),
      recent: recent.map(pack),
      offered: offered.map(pack),
      tokens,
    };
    if (
      !supported ||
      tokens.length > 8192 ||
      tokens.reduce((sum, token) => sum + token.units.length, 0) > 262144
    )
      return null;
    // Compact little-endian packet: no JSON parser or per-pair language calls.
    if (new Uint8Array(Uint32Array.of(1).buffer)[0] !== 1) return null;
    const words = [0x534f534f, 2, count, recent.length, offered.length, tokens.length];
    for (const token of tokens)
      words.push(token.units.length, token.numeric ? 1 : 0, ...token.units);
    const floating = new DataView(new ArrayBuffer(8));
    for (const song of [...job.candidates, ...job.recent, ...job.offered]) {
      floating.setFloat64(0, song.duration, true);
      words.push(
        song.tokens.length,
        song.artists.length,
        song.variants.length,
        floating.getUint32(0, true),
        floating.getUint32(4, true),
        ...song.tokens,
        ...song.artists,
        ...song.variants,
      );
    }
    const bytes = new Uint8Array(Uint32Array.from(words).buffer);
    if (bytes.length > MAX_INPUT) return null;
    const pointer = core.reserve(bytes.length);
    if (!pointer || pointer + bytes.length > core.memory.buffer.byteLength)
      throw Error('Invalid input buffer');
    new Uint8Array(core.memory.buffer, pointer, bytes.length).set(bytes);
    const size = core.calculate(bytes.length),
      output = core.output_ptr();
    if (size !== count * count + 2 * count || output + size > core.memory.buffer.byteLength)
      throw Error('Invalid result buffer');
    // The next call may grow WASM memory; this batch owns its result.
    const flags = new Uint8Array(core.memory.buffer, output, size).slice();
    return {
      wasHeard: (index) => flags[index] === 1,
      wasOffered: (index) => flags[count + index] === 1,
      sameSong: (left, right) => flags[2 * count + left * count + right] === 1,
    };
  } catch {
    core = null;
    unavailable();
    return null;
  }
}
