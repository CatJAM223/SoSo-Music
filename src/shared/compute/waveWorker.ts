import { initializeRustCompute } from './rustCore.ts';
import { resequenceWaveQueue } from '../utils/waveQueue.ts';
import type { WaveWorkerRequest, WaveWorkerReply } from './waveWorkerProtocol.ts';
// No DOM or remote code; the application supplies the same verified local WASM bytes.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WaveWorkerRequest>) => void) | null;
  postMessage: (reply: WaveWorkerReply) => void;
};
let ready: Promise<boolean> | null = null;
scope.onmessage = (event) => {
  const request = event.data;
  if (request.kind === 'init') {
    ready = initializeRustCompute(request.bytes);
    void ready.then((ok) =>
      scope.postMessage(
        ok
          ? { kind: 'ready' }
          : { kind: 'error', id: 0, message: 'Rust compute initialization failed' },
      ),
    );
    return;
  }
  if (request.kind !== 'resequence') return;
  void (async () => {
    try {
      if (!ready || !(await ready)) throw Error('Rust worker is not initialized');
      const queue = request.args[0],
        lookup = new Map(queue.map((track, index) => [track, index]));
      const result = resequenceWaveQueue(...request.args);
      scope.postMessage({
        kind: 'result',
        id: request.id,
        indices: result.map((track) => {
          const index = lookup.get(track);
          if (index === undefined) throw Error('Unknown queue result');
          return index;
        }),
      });
    } catch (error) {
      scope.postMessage({
        kind: 'error',
        id: request.id,
        message: error instanceof Error ? error.message : 'Rust worker failed',
      });
    }
  })();
};
