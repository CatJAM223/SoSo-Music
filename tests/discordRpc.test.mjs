import test from 'node:test';
import assert from 'node:assert/strict';

import { DiscordRPCService } from '../src/desktop/main/services/discordRpc.ts';

const formatTime = DiscordRPCService.formatDiscordTime;
const renderProgressBar = DiscordRPCService.renderProgressBar;
const buildActivityPayload = DiscordRPCService.buildActivityPayload;

test('Discord RPC: Time formatting helper', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(9), '0:09');
  assert.equal(formatTime(59), '0:59');
  assert.equal(formatTime(60), '1:00');
  assert.equal(formatTime(125), '2:05');
  assert.equal(formatTime(3600), '60:00');
  assert.equal(formatTime(-10), '0:00');
  assert.equal(formatTime(NaN), '0:00');
});

test('Discord RPC: Progress bar rendering at boundaries and intermediate ratios', () => {
  // Start (0%) -> dot at position 0, 10 dashes after
  const startBar = renderProgressBar(0, 200);
  assert.equal(startBar, '🔘──────────');
  assert.equal([...startBar].length, 11); // 1 dot + 10 dashes

  // Halfway (50%) -> 5 filled, dot, 5 empty
  const midBar = renderProgressBar(100, 200);
  assert.equal(midBar, '━━━━━🔘─────');
  assert.equal([...midBar].length, 11);

  // End (100%) -> 10 filled, dot, 0 empty
  const endBar = renderProgressBar(200, 200);
  assert.equal(endBar, '━━━━━━━━━━🔘');
  assert.equal([...endBar].length, 11);

  // Overshoot clamp (>100%)
  const overBar = renderProgressBar(350, 200);
  assert.equal(overBar, '━━━━━━━━━━🔘');

  // Undershoot clamp (<0%)
  const underBar = renderProgressBar(-50, 200);
  assert.equal(underBar, '🔘──────────');

  // Zero total duration guard
  const zeroBar = renderProgressBar(50, 0);
  assert.equal(zeroBar, '🔘──────────');
});

test('Discord RPC: Activity payload construction when playing vs paused', () => {
  const mockNow = 1700000000000;
  const playingData = {
    title: 'One More Time',
    artist: 'Daft Punk',
    album: 'Discovery',
    duration: 320,
    currentTime: 64,
    isPlaying: true,
    coverUrl: 'https://cdn.example.com/cover.jpg',
  };

  const payloadPlaying = buildActivityPayload(playingData, mockNow);
  assert.equal(payloadPlaying.details, 'One More Time (1:04 / 5:20)');
  assert.equal(payloadPlaying.state, 'Daft Punk  ·  ━━🔘────────');
  assert.equal(payloadPlaying.timestamps.start, mockNow - 64 * 1000);
  assert.equal(payloadPlaying.timestamps.end, mockNow - 64 * 1000 + 320 * 1000);
  assert.equal(payloadPlaying.assets.small_text, 'Воспроизводится');

  const pausedData = {
    ...playingData,
    isPlaying: false,
  };
  const payloadPaused = buildActivityPayload(pausedData, mockNow);
  assert.equal(payloadPaused.state, 'Daft Punk  ·  ⏸ Пауза');
  assert.equal(payloadPaused.timestamps, undefined);
  assert.equal(payloadPaused.assets.small_text, 'Пауза');
});

test('Discord RPC: String truncation to prevent IPC packet overflows (>80 chars)', () => {
  const longData = {
    title: 'A'.repeat(120),
    artist: 'B'.repeat(120),
    duration: 180,
    currentTime: 0,
    isPlaying: true,
  };

  const payload = buildActivityPayload(longData);
  assert.ok(payload.details.startsWith('A'.repeat(80)));
  assert.ok(payload.state.startsWith('B'.repeat(80)));
});
