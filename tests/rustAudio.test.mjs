import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RustTsDemuxer,
  RustLoudnessMeter,
  createAudioCore,
} from '../src/shared/compute/audioCore.ts';
import { scoreImportCandidate } from '../src/shared/services/playlistImport.ts';
import { scoreImportCandidate as oldScore } from './fixtures/importBeforeRust.ts';
import { fetchCompleteAudioBlob } from '../src/shared/services/offlineCacheService.ts';
import { concat, packet, crcSection, transportFixture } from './helpers/mpegTsFixture.mjs';

const payload = Uint8Array.from({ length: 78000 }, (_, i) => (i * 73 + 3) % 256);
function extract(bytes, size = 1024 * 1024) {
  const demux = new RustTsDemuxer(),
    parts = [];
  for (let i = 0; i < bytes.length; i += size)
    parts.push(...demux.push(bytes.subarray(i, i + size)));
  return { bytes: concat(parts), mime: demux.finish() };
}
for (const size of [1, 7, 187, 188, 189, 511, 16384, 1024 * 1024])
  test('Rust TS demux: byte-exact selected audio, arbitrary boundaries ' + size, () => {
    const fixture = transportFixture(payload);
    const result = extract(fixture.bytes, size);
    assert.deepEqual(result.bytes, payload);
    assert.equal(result.mime, 'audio/aac');
  });
test('Rust TS demux: concurrent jobs own independent continuity/PES state and MPEG codec', () => {
  const left = new RustTsDemuxer(),
    right = new RustTsDemuxer();
  const a = transportFixture(payload),
    b = transportFixture(payload.subarray(0, 5000), { codec: 3 });
  const ap = [],
    bp = [];
  for (let i = 0; i < Math.max(a.packets.length, b.packets.length); i++) {
    if (a.packets[i]) ap.push(...left.push(a.packets[i]));
    if (b.packets[i]) bp.push(...right.push(b.packets[i]));
  }
  assert.deepEqual(concat(ap), payload);
  assert.deepEqual(concat(bp), payload.subarray(0, 5000));
  assert.equal(left.finish(), 'audio/aac');
  assert.equal(right.finish(), 'audio/mpeg');
});
test('Rust TS demux: corrupt PSI CRC, missing packets, scrambling and truncated PES fail explicitly', () => {
  const { packets, bytes } = transportFixture(payload);
  const badCrc = bytes.slice();
  badCrc[187] ^= 1;
  assert.throws(() => extract(badCrc));
  const missing = concat(packets.filter((_, i) => i !== 6));
  assert.throws(() => extract(missing));
  const scrambled = bytes.slice();
  scrambled[2 * 188 + 3] |= 0x80;
  // Packet 2 is video and may be safely ignored, then corrupt the actual audio packet.
  scrambled[3 * 188 + 3] |= 0x80;
  assert.throws(() => extract(scrambled));
  assert.throws(() => extract(bytes.subarray(0, bytes.length - 1)));
  assert.throws(() => extract(concat(packets.slice(0, -3))));
  assert.throws(() => extract(transportFixture(payload, { codec: 0x11 }).bytes));
});
test('Rust TS demux: PSI and PES headers can span packets; duplicate transport packets are ignored', () => {
  const f = transportFixture(payload, { headerLength: 255 });
  const pat = crcSection([0, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xe1, 0]);
  const fragmented = [
    packet(0, concat([[0], pat.subarray(0, 6)]), true),
    packet(0, pat.subarray(6), false, 1),
    ...f.packets.slice(1),
  ];
  fragmented.splice(8, 0, fragmented[7]);
  assert.deepEqual(extract(concat(fragmented), 257).bytes, payload);
});

const tone = (amplitude, frequency = 997, seconds = 4) =>
  Float32Array.from(
    { length: 48000 * seconds },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / 48000),
  );
function measure(channels, quantum = 128) {
  const meter = new RustLoudnessMeter(channels.length, 48000, Math.max(quantum, 128));
  for (let at = 0; at < channels[0].length; at += quantum)
    meter.push(channels.map((channel) => channel.subarray(at, at + quantum)));
  meter.gap();
  return meter.read();
}
const near = (a, b, tolerance = 0.1) => assert.ok(Math.abs(a - b) < tolerance, `${a} ~= ${b}`);
test('Rust BS.1770: 997 Hz mono calibration and stereo summation', () => {
  const samples = tone(1),
    mono = measure([samples]),
    stereo = measure([samples, samples]);
  near(mono.lufs, -3.01, 0.03);
  near(stereo.lufs, 0, 0.03);
  near(mono.truePeakDb, 0, 0.15);
  near(stereo.lufs - mono.lufs, 10 * Math.log10(2), 1e-7);
});
test('Rust BS.1770: streaming block sizes, amplitude differences and silence gating', () => {
  const a = tone(0.3),
    b = tone(0.03),
    loud = measure([a, a]),
    quiet = measure([b, b]);
  near(loud.lufs - quiet.lufs, 20, 0.001);
  near(quiet.gainDb - loud.gainDb, 20, 0.001);
  near(measure([a, a], 511).lufs, loud.lufs, 1e-8);
  const tail = new Float32Array(48000 * 12);
  tail.set(a);
  // Only four transitional overlap windows can affect the gated mean.
  near(measure([tail, tail]).lufs, loud.lufs, 0.3);
  const silence = measure([new Float32Array(48000 * 4)]);
  assert.ok(Number.isNaN(silence.gainDb));
  assert.equal(silence.blocks, 0);
  const short = measure([tone(0.1, 997, 1)]);
  assert.ok(Number.isNaN(short.gainDb));
});
test('Rust true peak: reconstructs intersample peaks and limits the normalization boost', () => {
  const samples = Float32Array.from(
    { length: 48000 * 4 },
    (_, i) => 0.9 * Math.sin(2 * Math.PI * 0.25 * i + Math.PI / 4),
  );
  const stats = measure([samples]);
  const samplePeak = 20 * Math.log10(Math.max(...samples.subarray(0, 1000).map(Math.abs)));
  assert.ok(stats.truePeakDb > samplePeak + 2.5);
  near(stats.truePeakDb, 20 * Math.log10(0.9), 0.3);
  const transient = tone(0.001);
  transient[48000 * 2] = 0.99;
  const peaked = measure([transient]);
  assert.ok(peaked.gainDb <= -1 - peaked.truePeakDb + 1e-8);
});
test('Rust loudness: gaps discard incomplete windows and invalid data cannot produce a boost', () => {
  const m = new RustLoudnessMeter(1),
    s = tone(0.1, 997, 0.2);
  for (let at = 0; at < s.length; at += 128) m.push([s.subarray(at, at + 128)]);
  m.gap();
  for (let at = 0; at < s.length; at += 128) m.push([s.subarray(at, at + 128)]);
  assert.equal(m.read().blocks, 0);
  const bad = new Float32Array([NaN]);
  assert.throws(() => m.push([bad]));
  assert.ok(Number.isNaN(m.read().gainDb));
  assert.throws(() => new RustLoudnessMeter(2, 24000));
  assert.throws(() => new RustLoudnessMeter(3));
  const e = createAudioCore();
  assert.equal(e.loudness_push(4), -1);
  assert.equal(e.demux_push(1048577), -1);
});

test('Rust import scorer: matches the independent historical scorer across metadata/version/duration edges', () => {
  const titles = [
    'Hate',
    'No Idea',
    'Король и Шут',
    'Капитан',
    'Don Toliver - No Idea (Official Audio)',
    'f**k love',
    'fucking love',
    'foo foo bar',
    '𐐀𐐨abcd Love',
    'Song live',
    'Song remix',
    'Song sped up',
    'Song slowed reverb',
    'Song акустика',
  ];
  const artists = [
    'Don Toliver',
    'ThxSoMuch',
    'Король и Шут',
    'Miyagi',
    'Don Toliver - Topic',
    'Uploader',
    'Don Toliver, Friend',
  ];
  let pairs = 0;
  for (let i = 0; i < titles.length; i++)
    for (let j = 0; j < titles.length; j++)
      for (const duration of [0, 8, 35, 180, 187, 240]) {
        const original = {
          id: 'o',
          title: titles[i],
          artist: artists[i % artists.length],
          duration,
        };
        const candidate = {
          id: 'yt_12345678901',
          source: 'youtube',
          title: titles[j],
          artist: { name: artists[j % artists.length] },
          duration: 180,
        };
        assert.deepEqual(scoreImportCandidate(original, candidate), oldScore(original, candidate));
        pairs++;
      }
  assert.equal(pairs, 1176);
});

test('HLS offline download: Rust extraction integrates with the real native transport and discontinuities', async (t) => {
  const oldWindow = globalThis.window,
    oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.window = oldWindow;
    globalThis.fetch = oldFetch;
  });
  const body = Uint8Array.from({ length: 40000 }, (_, i) => i % 251);
  const a = transportFixture(body),
    b = transportFixture(body.subarray(0, 25000));
  const sources = new Map([
    ['https://fixture.invalid/a.ts', a.bytes],
    ['https://fixture.invalid/b.ts', b.bytes],
  ]);
  let active = 0,
    maxActive = 0;
  globalThis.window = {
    electronAPI: {
      downloadAudioBuffer: async (url) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        const bytes = sources.get(url);
        assert.ok(bytes);
        // An IPC view may have a non-zero offset within a larger backing buffer.
        const backing = new Uint8Array(bytes.length + 30);
        backing.set(bytes, 15);
        return backing.subarray(15, 15 + bytes.length);
      },
    },
  };
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://fixture.invalid/audio.m3u8');
    return new Response(
      '#EXTM3U\n#EXTINF:2,\na.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:2,\nb.ts\n#EXT-X-ENDLIST',
    );
  };
  const progress = [],
    blob = await fetchCompleteAudioBlob('https://fixture.invalid/audio.m3u8', (v) =>
      progress.push(v),
    );
  assert.equal(blob.type, 'audio/aac');
  assert.deepEqual(
    new Uint8Array(await blob.arrayBuffer()),
    concat([body, body.subarray(0, 25000)]),
  );
  assert.ok(maxActive <= 6);
  near(progress.at(-1), 0.82, 1e-12);
});
test('HLS offline download: fragmented MP4 init/media passes through byte-exact without TS parsing', async (t) => {
  const oldWindow = globalThis.window,
    oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.window = oldWindow;
    globalThis.fetch = oldFetch;
  });
  const init = new Uint8Array(1200),
    media = new Uint8Array(25000).fill(9);
  init.set([0, 0, 0, 20, 102, 116, 121, 112]);
  globalThis.window = {
    electronAPI: { downloadAudioBuffer: async (url) => (url.endsWith('init.mp4') ? init : media) },
  };
  globalThis.fetch = async () =>
    new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nchunk.m4s\n#EXT-X-ENDLIST');
  const blob = await fetchCompleteAudioBlob('https://fixture.invalid/audio.m3u8');
  assert.equal(blob.type, 'audio/mp4');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), concat([init, media]));
});
test('HLS offline download: corrupt transport never becomes a mislabeled playable cache blob', async (t) => {
  const oldWindow = globalThis.window,
    oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.window = oldWindow;
    globalThis.fetch = oldFetch;
  });
  globalThis.window = {
    electronAPI: { downloadAudioBuffer: async () => new Uint8Array(30000).fill(7) },
  };
  globalThis.fetch = async () => new Response('#EXTM3U\nsegment.ts');
  await assert.rejects(fetchCompleteAudioBlob('https://fixture.invalid/audio.m3u8'), /MPEG-TS/);
});
