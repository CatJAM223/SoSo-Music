import test from 'node:test';
import assert from 'node:assert/strict';

import { LyricsService, cleanLyricText } from '../src/desktop/main/services/lyricsService.ts';

const parseLrc = LyricsService.parseLrc.bind(LyricsService);
const parsePlainLyrics = LyricsService.parsePlainLyrics.bind(LyricsService);

test('LyricsService: Parse LRC content with timestamps', () => {
  const lrc = `
[00:04.50] Вижу — поднимается с колен моя Родина
[00:08.20] Слышу, как поёт моя великая Родина
[00:14.00] Снова поднимается с колен моя Родина
  `;
  const parsed = parseLrc(lrc);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].time, 4.5);
  assert.equal(parsed[0].text, 'Вижу — поднимается с колен моя Родина');
  assert.equal(parsed[1].time, 8.2);
  assert.equal(parsed[2].time, 14.0);
});

test('LyricsService: Filter out LRC headers and metadata', () => {
  const lrc = `
[ar:Гражданская Оборона]
[ti:Родина]
[al:Русское поле экспериментов]
[length:03:20]
[00:05.00] Вижу как из пепла восстаёт моя Родина
  `;
  const parsed = parseLrc(lrc);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].text, 'Вижу как из пепла восстаёт моя Родина');
});

test('LyricsService: Parse plain lyrics with uniform spacing', () => {
  const plain = `
Вижу — поднимается с колен моя Родина
Вижу, как из пепла восстаёт моя Родина
Слышу, как поёт моя великая Родина
  `;
  const parsed = parsePlainLyrics(plain, 180);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].time, -1);
  assert.equal(parsed[0].text, 'Вижу — поднимается с колен моя Родина');
  assert.equal(parsed[1].time, -1);
  assert.equal(parsed[2].time, -1);
});

test('LyricsService: Malformed, missing brackets or corrupt timestamp lines are safely ignored', () => {
  const corruptLrc = `
[99:99:99] Too many colons
[invalid] No timestamp digits
[00:15.00 Missing closing bracket
Just plain text line without brackets
[00:20.50] Valid line that survives corrupt lines
  `;
  const parsed = parseLrc(corruptLrc);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].time, 20.5);
  assert.equal(parsed[0].text, 'Valid line that survives corrupt lines');
});
