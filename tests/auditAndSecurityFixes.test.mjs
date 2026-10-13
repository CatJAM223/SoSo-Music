import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiscordRPCService } from '../src/desktop/main/services/discordRpc.ts';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';

import { toMediaFileUrl } from '../src/shared/utils/formatters.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Audit Fix: Content Security Policy in index.html is strict and allows media scheme', () => {
  const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf-8');
  assert.ok(indexHtml.includes('http-equiv="Content-Security-Policy"'));
  assert.ok(!indexHtml.includes("'unsafe-eval'"), 'CSP must NOT include unsafe-eval');
  assert.ok(
    indexHtml.includes("media-src 'self' blob: https: media:"),
    'media-src must include media: scheme',
  );
  assert.ok(
    indexHtml.includes("img-src 'self' data: https: blob: media:"),
    'img-src must include media: scheme',
  );
});

test('Audit Fix: WallpaperBackground URL generator uses media://local/ custom scheme', () => {
  // Windows path
  assert.equal(
    toMediaFileUrl('C:\\Users\\User\\Videos\\wallpaper.mp4'),
    'media://local/C:/Users/User/Videos/wallpaper.mp4',
  );
  // Legacy file URL
  assert.equal(
    toMediaFileUrl('file:///C:/Users/User/Videos/wallpaper.mp4'),
    'media://local/C:/Users/User/Videos/wallpaper.mp4',
  );
  // Path with spaces and hash
  assert.equal(
    toMediaFileUrl('C:\\Media\\my #1 video.mp4'),
    'media://local/C:/Media/my%20%231%20video.mp4',
  );
  // HTTPS URL untouched
  assert.equal(toMediaFileUrl('https://example.com/video.mp4'), 'https://example.com/video.mp4');
});

test('Audit Fix: Discord RPC packet framing accumulator handles fragmented and fused chunks', () => {
  const OP_FRAME = 1;
  const payloadObj = { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } };
  const payloadStr = JSON.stringify(payloadObj);
  const payloadBuf = Buffer.from(payloadStr, 'utf-8');

  // Build a valid 8-byte framed packet
  const packet = Buffer.alloc(8 + payloadBuf.length);
  packet.writeInt32LE(OP_FRAME, 0);
  packet.writeInt32LE(payloadBuf.length, 4);
  payloadBuf.copy(packet, 8);

  // Test 1: Fragmented packet arriving in 3 tiny chunks
  const chunk1 = packet.subarray(0, 4); // opcode only
  const chunk2 = packet.subarray(4, 12); // length + first 4 bytes of body
  const chunk3 = packet.subarray(12); // rest of body

  let acc = Buffer.alloc(0);

  acc = Buffer.concat([acc, chunk1]);
  const res1 = DiscordRPCService.parseFramedPackets(acc);
  acc = res1.remaining;
  assert.equal(res1.packets.length, 0, 'No packet should be parsed yet after chunk 1');

  acc = Buffer.concat([acc, chunk2]);
  const res2 = DiscordRPCService.parseFramedPackets(acc);
  acc = res2.remaining;
  assert.equal(res2.packets.length, 0, 'No packet should be parsed yet after chunk 2');

  acc = Buffer.concat([acc, chunk3]);
  const res3 = DiscordRPCService.parseFramedPackets(acc);
  acc = res3.remaining;
  assert.equal(res3.packets.length, 1, 'Packet should be fully parsed after chunk 3');
  assert.deepEqual(res3.packets[0].data, payloadObj);

  // Test 2: Two fused packets arriving in a single buffer
  const fused = Buffer.concat([packet, packet]);
  const resFused = DiscordRPCService.parseFramedPackets(fused);
  assert.equal(resFused.packets.length, 2, 'Both packets should be parsed from fused buffer');
  assert.equal(resFused.remaining.length, 0);
});

test('Charts: Desktop SoundCloud routing', async (t) => {
  const desktopTrack = { id: 'sc_desktop_1', title: 'Desktop chart track' };
  t.mock.method(SoundCloudService, 'getCharts', async () => ({ tracks: { data: [desktopTrack] } }));
  const charts = await MusicAggregatorService.getCharts('soundcloud');
  assert.deepEqual(charts.tracks.data, [desktopTrack]);
});
