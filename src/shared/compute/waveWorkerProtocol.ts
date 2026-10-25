import type { resequenceWaveQueue } from '../utils/waveQueue.ts';
export type WaveResequenceArgs = Parameters<typeof resequenceWaveQueue>;
export type WaveWorkerRequest =
  | { kind: 'init'; bytes: Uint8Array<ArrayBuffer> }
  | { kind: 'resequence'; id: number; args: WaveResequenceArgs };
export type WaveWorkerReply =
  | { kind: 'ready' }
  | { kind: 'result'; id: number; indices: number[] }
  | { kind: 'error'; id: number; message: string };
