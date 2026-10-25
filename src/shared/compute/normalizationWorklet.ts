import { initializeRustCompute } from './rustCore.ts';
import { RustLoudnessMeter } from './audioCore.ts';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class NormalizationProcessor extends AudioWorkletProcessor {
  private ready = false;
  private active = true;
  private failed = false;
  private meter: RustLoudnessMeter | null = null;
  private meters: RustLoudnessMeter[] = [];
  private untilReport = 0;
  constructor() {
    super();
    this.port.onmessage = async ({ data }) => {
      if (data.type === 'init') {
        try {
          if (sampleRate !== 48000 || !(await initializeRustCompute(data.bytes)))
            throw Error('WASM initialization');
          this.meters = [
            new RustLoudnessMeter(1, sampleRate, 16384),
            new RustLoudnessMeter(2, sampleRate, 16384),
          ];
          this.ready = true;
        } catch {
          this.ready = false;
        }
        this.port.postMessage({ type: this.ready ? 'ready' : 'error' });
      } else if (data.type === 'active') {
        this.active = data.active;
        this.meter?.gap();
        this.report();
      }
    };
  }
  private report() {
    if (this.meter) {
      const stats = this.meter.read();
      if (stats.samples >= sampleRate * 15 && stats.blocks === 0) {
        this.failed = true;
        this.port.postMessage({ type: 'error' });
      } else this.port.postMessage({ type: 'stats', stats });
    }
  }
  process(inputs: Float32Array[][]): boolean {
    // The node has a silent output and cannot replace/interfere with the player's audio path.
    const channels = inputs[0];
    if (!this.ready || !this.active || this.failed || !channels?.[0]?.length) return true;
    try {
      if (!this.meter) this.meter = this.meters[channels.length - 1];
      if (!this.meter) throw Error('Unsupported channels');
      this.meter.push(channels);
      this.untilReport -= channels[0].length;
      if (this.untilReport <= 0) {
        this.untilReport = sampleRate;
        this.report();
      }
    } catch {
      this.failed = true;
      this.port.postMessage({ type: 'error' });
    }
    return true;
  }
}
registerProcessor('soso-normalization', NormalizationProcessor);
