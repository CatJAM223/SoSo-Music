import fs from 'node:fs/promises';
import { initializeRustCompute } from '../../src/shared/compute/rustCore.ts';
import { logger } from '../../src/shared/utils/logger.ts';
import { sequenceWaveIndices } from '../../src/shared/compute/waveSequence.ts';
logger.setLevel('warn');
if (
  !(await initializeRustCompute(
    await fs.readFile(new URL('../../public/compute/soso-core.wasm', import.meta.url)),
  ))
)
  throw Error('Rust core unavailable');
const song = (id, title, artist, recordingId) => ({
  id,
  title,
  artist: { name: artist },
  album: { title: '' },
  duration: 180,
  source: id.startsWith('yt_') ? 'youtube' : 'soundcloud',
  preview: '',
  recordingId,
});
const cohorts = [];
for (const mood of ['default', 'energy', 'chill', 'discover', 'mix', 'favorites']) {
  const history = [song('yt_original', 'Silver River', 'Fixture Band', 'rec:youtube:original')];
  const tracks = [
    song(
      'sc_alias',
      'Catalog renamed this recording',
      'New catalog credit',
      'rec:youtube:original',
    ),
    song('yt_fresh', 'Another Different Tune', 'Other Artist', 'rec:youtube:fresh'),
    song('sc_novel', 'Distant Northern Lights', 'Novel Artist', 'rec:soundcloud:novel'),
  ];
  const strip = (track) => ({ ...track, recordingId: undefined });
  const baseline = sequenceWaveIndices(tracks.map(strip), mood, [], 3, {
    recentTracks: history.map(strip),
  });
  const canonical = sequenceWaveIndices(tracks, mood, [], 3, { recentTracks: history });
  const repeated = (order) =>
    order.filter((index) => tracks[index].recordingId === history[0].recordingId).length;
  const fresh = (order) =>
    order.filter((index) => tracks[index].recordingId !== history[0].recordingId).length;
  cohorts.push({
    mood,
    baseline: {
      selected: baseline.length,
      knownRecordingRepeats: repeated(baseline),
      freshRecordings: fresh(baseline),
    },
    canonical: {
      selected: canonical.length,
      knownRecordingRepeats: repeated(canonical),
      freshRecordings: fresh(canonical),
    },
  });
}
console.log(
  JSON.stringify(
    {
      schema: 1,
      fixture: 'synthetic-verified-alias-metadata-change',
      ranker: 'same production Rust sequence_wave in both arms',
      note: 'A deterministic identity regression, not a listener-preference experiment or service-availability benchmark.',
      cohorts,
    },
    null,
    2,
  ),
);
if (
  cohorts.some(
    (c) =>
      c.canonical.knownRecordingRepeats !== 0 ||
      c.canonical.freshRecordings < c.baseline.freshRecordings,
  )
)
  process.exitCode = 1;
