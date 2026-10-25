import { requireRustCompute, rustComputeBytes } from './rustCore.ts';

let compiledModule: WebAssembly.Module | null = null;

/** Stateful audio jobs get isolated WASM memory; overlapping downloads/recordings cannot mix. */
export function createAudioCore() {
  requireRustCompute();
  const module = (compiledModule ??= new WebAssembly.Module(rustComputeBytes()));
  return new WebAssembly.Instance(module, {}).exports as unknown as ReturnType<
    typeof requireRustCompute
  >;
}
export function copyAudioInput(
  engine: ReturnType<typeof createAudioCore>,
  bytes: Uint8Array,
): number {
  const pointer = engine.reserve(bytes.byteLength);
  if (!pointer || pointer + bytes.byteLength > engine.memory.buffer.byteLength)
    throw Error('Invalid Rust audio buffer');
  new Uint8Array(engine.memory.buffer, pointer, bytes.byteLength).set(bytes);
  return pointer;
}
export class RustTsDemuxer {
  private engine = createAudioCore();
  constructor() {
    this.engine.demux_reset();
  }
  push(bytes: Uint8Array): Uint8Array<ArrayBuffer>[] {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
      const part = bytes.subarray(offset, offset + 1024 * 1024);
      copyAudioInput(this.engine, part);
      const size = this.engine.demux_push(part.byteLength);
      if (size < 0) throw Error('Повреждённый или неподдерживаемый MPEG-TS поток');
      if (size)
        chunks.push(
          new Uint8Array(this.engine.memory.buffer, this.engine.output_ptr(), size).slice(),
        );
    }
    return chunks;
  }
  boundary(): void {
    if (this.engine.demux_boundary() !== 0) throw Error('Неполный MPEG-TS сегмент перед разрывом');
  }
  finish(): 'audio/aac' | 'audio/mpeg' {
    const codec = this.engine.demux_finish();
    if (codec !== 1 && codec !== 2) throw Error('Неполный MPEG-TS аудиопоток');
    return codec === 1 ? 'audio/aac' : 'audio/mpeg';
  }
}
export interface LoudnessStats {
  lufs: number;
  truePeakDb: number;
  gainDb: number;
  blocks: number;
  samples: number;
}
export class RustLoudnessMeter {
  private engine = createAudioCore();
  private packet: Float32Array<ArrayBuffer>;
  readonly channels: number;
  readonly sampleRate: number;
  readonly capacity: number;
  constructor(channels = 2, sampleRate = 48000, capacity = 128) {
    this.channels = channels;
    this.sampleRate = sampleRate;
    this.capacity = capacity;
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 16384 ||
      this.engine.loudness_reset(sampleRate, channels) !== 0
    )
      throw Error('Unsupported loudness input');
    this.packet = new Float32Array(capacity * channels);
    // Reserve the maximal render quantum before the realtime callback starts.
    copyAudioInput(this.engine, new Uint8Array(this.packet.buffer));
  }
  push(channels: readonly Float32Array[]): void {
    const frames = channels[0]?.length ?? 0;
    if (
      channels.length !== this.channels ||
      !frames ||
      frames > this.capacity ||
      channels.some((c) => c.length !== frames)
    )
      throw Error('Invalid PCM block');
    channels.forEach((channel, i) => this.packet.set(channel, i * frames));
    copyAudioInput(this.engine, new Uint8Array(this.packet.buffer, 0, frames * this.channels * 4));
    if (this.engine.loudness_push(frames * this.channels * 4) !== 0)
      throw Error('Rust loudness rejected PCM');
  }
  gap(): void {
    this.engine.loudness_gap();
  }
  read(): LoudnessStats {
    if (this.engine.loudness_read() !== 40) throw Error('Invalid loudness result');
    const view = new DataView(this.engine.memory.buffer, this.engine.output_ptr(), 40);
    return {
      lufs: view.getFloat64(0, true),
      truePeakDb: view.getFloat64(8, true),
      gainDb: view.getFloat64(16, true),
      blocks: view.getFloat64(24, true),
      samples: view.getFloat64(32, true),
    };
  }
}
