import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sequenceWaveTracks } from '../../src/shared/utils/waveQueue.ts';
import { initializeRustCompute } from '../../src/shared/compute/waveSongMatrix.ts';
import { sequenceWaveTracks as reference } from '../../tests/fixtures/waveSequenceReference.mjs';
const root = new URL('../../', import.meta.url);
const names = [
  'Nirvana',
  'Гражданская оборона',
  'CUPSIZE',
  'madk1d',
  'ThxSoMch',
  'Øneheart',
  'Пошлая Молли',
  'Дайте танк (!)',
  'Kordhell',
  'The Weeknd',
  'Kai Angel',
  'Молчат Дома',
];
const titles = [
  'Smells Like Teen Spirit',
  'Murder In My Mind',
  'Дырки в штанах',
  'Девочка в классе',
  'Ты любишь танцевать',
  'Государство',
  'Новая патриотическая',
  'Home Again Tonight',
  'Cold Summer Nights',
  'Lost Memory Dreams',
  'The Long Road Home',
  'Закрой глаза',
];
const variants = ['', ' (Official Audio)', ' (Sped Up)', ' (Slowed + Reverb)', ' (Live)', ''];
function tracks(count, start = 0) {
  return Array.from({ length: count }, (_, index) => {
    const i = start + index,
      artist = names[i % names.length] + ' Artist ' + (i % 47);
    const nonce = (value) =>
      (Math.imul(value + 17, 2654435761) >>> 0).toString(36).padStart(7, 'x');
    return {
      id: 'sc_' + i,
      title:
        (i % 11 === 0 ? artist + ' - ' : '') +
        titles[i % titles.length] +
        ' ' +
        nonce(i) +
        ' ' +
        nonce(i + 113) +
        variants[i % variants.length],
      artist: { name: i % 9 === 0 ? artist + ' feat. ' + names[(i + 3) % names.length] : artist },
      album: { title: i % 3 ? 'Single' : 'Album' },
      duration: 150 + (i % 160),
      source: i % 2 ? 'youtube' : 'soundcloud',
    };
  });
}
function measure(fn) {
  for (let i = 0; i < 3; i++) fn();
  const values = [];
  for (let i = 0; i < 12; i++) {
    const start = performance.now();
    fn();
    values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  return { medianMs: values[6], p95Ms: values[11] };
}
const cases = [
  [60, 40, 40, 25],
  [120, 300, 80, 25],
  [200, 300, 80, 25],
  [60, 300, 80, 60],
].map(([count, history, offered, limit]) => {
  const input = tracks(count),
    familiar = [...new Set(input.slice(0, 30).map((track) => track.artist.name))];
  const options = {
    recentTracks: tracks(history, 5000),
    offeredTracks: tracks(offered, 7000),
    artistFeedback: new Map(
      familiar.map((artist, i) => [artist.toLowerCase(), i % 3 === 0 ? -0.5 : 0.5]),
    ),
  };
  return { count, history, limit, input, familiar, options };
});
const report = {
  method:
    'Offline synthetic data; live production imports vs frozen pre-Rust JS reference; warm median/p95, no network or user library. This measures local sequencing, not music request latency.',
  node: process.version,
  cases: [],
};
for (const item of cases) {
  const { count, history, limit, input, familiar, options } = item;
  assert.deepEqual(
    sequenceWaveTracks(input, 'energy', familiar, limit, options),
    reference(input, 'energy', familiar, limit, options),
  );
  report.cases.push({
    count,
    history,
    limit,
    reference: measure(() => reference(input, 'energy', familiar, limit, options)),
    jsMemo: measure(() => sequenceWaveTracks(input, 'energy', familiar, limit, options)),
  });
}
assert.equal(
  await initializeRustCompute(fs.readFileSync(new URL('public/compute/soso-core.wasm', root))),
  true,
);
for (let i = 0; i < cases.length; i++) {
  const { input, familiar, limit, options } = cases[i];
  for (const mood of ['default', 'energy', 'chill', 'discover', 'mix', 'favorites'])
    assert.deepEqual(
      sequenceWaveTracks(input, mood, familiar, limit, options),
      reference(input, mood, familiar, limit, options),
    );
  report.cases[i].rustMemo = measure(() =>
    sequenceWaveTracks(input, 'energy', familiar, limit, options),
  );
}
const target = new URL('scratch/wave-compute-benchmark.json', root);
fs.mkdirSync(new URL('scratch/', root), { recursive: true });
fs.writeFileSync(target, JSON.stringify(report, null, 2));
console.table(
  report.cases.map((item) => ({
    candidates: item.count,
    history: item.history,
    referenceMs: item.reference.medianMs.toFixed(2),
    jsMemoMs: item.jsMemo.medianMs.toFixed(2),
    rustMemoMs: item.rustMemo.medianMs.toFixed(2),
  })),
);
console.log('Report: ' + fileURLToPath(target));
