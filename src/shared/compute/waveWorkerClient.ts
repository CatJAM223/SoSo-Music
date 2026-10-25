import type { Track } from '../types/index.ts';
import type { WaveResequenceArgs } from './waveWorkerProtocol.ts';
import { rustComputeBytes } from './rustCore.ts';
import { WaveWorkerTransport, type ComputeWorkerPort } from './waveWorkerTransport.ts';
const transport = new WaveWorkerTransport(
  () =>
    new Worker(new URL('./waveWorker.ts', import.meta.url), {
      type: 'module',
      name: 'soso-wave',
    }) as ComputeWorkerPort,
  rustComputeBytes,
);
function metadata(track: Track): Track {
  return {
    id: track.id,
    title: track.title,
    artist: { name: track.artist?.name || '' },
    source: track.source,
    duration: track.duration,
    album: { title: track.album?.title || '' },
    genre: track.genre,
    tags: track.tags,
    playbackUnavailable: track.playbackUnavailable,
    waveSeedWeight: track.waveSeedWeight,
    waveGenreScore: track.waveGenreScore,
    waveRadioScore: track.waveRadioScore,
  } as Track;
}
/** Clone only compute inputs; artwork/audio URLs and original Track objects stay in the UI. */
export async function resequenceWaveQueueInWorker(...args: WaveResequenceArgs): Promise<Track[]> {
  const [queue, index, mood, familiar, feedback, history = [], offered = [], options = {}] = args;
  const payload: WaveResequenceArgs = [
    queue.map(metadata),
    index,
    mood,
    [...familiar],
    new Map(feedback),
    history.map(metadata),
    offered.map(metadata),
    {
      ...options,
      tasteTracks: options.tasteTracks?.map(metadata),
      positiveTracks: options.positiveTracks?.map(metadata),
      skippedTracks: options.skippedTracks?.map(metadata),
      learnedTracks: options.learnedTracks?.map(metadata),
    },
  ];
  const indices = await transport.resequence(payload);
  if (indices.some((i) => i >= queue.length))
    throw Error('Rust worker returned invalid queue indices');
  return indices.map((i) => queue[i]);
}
export function disposeWaveWorker(): void {
  transport.dispose();
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', disposeWaveWorker);
