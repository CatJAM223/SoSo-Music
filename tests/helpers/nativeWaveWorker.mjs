import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
const result = await build({
  entryPoints: [fileURLToPath(new URL('../../src/shared/compute/waveWorker.ts', import.meta.url))],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  logLevel: 'silent',
});
const source =
  `const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:m=>parentPort.postMessage(m),onmessage:null};parentPort.on('message',data=>self.onmessage?.({data}));` +
  result.outputFiles[0].text;
export function createNativeWaveWorker() {
  const worker = new Worker(source, { eval: true });
  const port = {
    postMessage: (m, t) => worker.postMessage(m, t),
    terminate: () => {
      void worker.terminate();
    },
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
  worker.on('message', (data) => port.onmessage?.({ data }));
  worker.on('error', (error) => port.onerror?.({ message: error.message, preventDefault() {} }));
  worker.on('messageerror', (data) => port.onmessageerror?.({ data }));
  return port;
}
