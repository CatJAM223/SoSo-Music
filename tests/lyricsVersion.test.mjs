import test from 'node:test';
import assert from 'node:assert/strict';

const { LyricsService } = await import('../src/desktop/main/services/lyricsService.ts');

test('Lyrics version filter: live / remix / sped-up candidates get a heavy penalty', () => {
  const heavy = [
    'Track Name (Live)',
    'Track Name - Live at Stadium',
    'Track Name (Remix 2024)',
    'Track Name (Sped Up)',
    'track name slowed + reverb',
    'Track (Nightcore Version)',
    'Песня (Концертная версия)',
    'Песня (Кавер на оригинал)',
    'Песня (Ремикс)',
  ];
  for (const name of heavy) {
    assert.strictEqual(
      LyricsService.versionPenalty(name),
      400,
      `"${name}" must be treated as an obviously wrong version`,
    );
  }
});

test('Lyrics version filter: studio titles and mild remaster markers stay preferred', () => {
  assert.strictEqual(LyricsService.versionPenalty('Track Name'), 0);
  assert.strictEqual(LyricsService.versionPenalty('Трек Название'), 0);
  assert.strictEqual(LyricsService.versionPenalty('Track Name (2011 Remaster)'), 60);
  assert.strictEqual(LyricsService.versionPenalty(null), 0);
  assert.strictEqual(LyricsService.versionPenalty(undefined), 0);
});

test('LyricsService.parseLrc applies [offset:] tag and sorts lines', () => {
  const lrc = ['[offset:+500]', '[00:10.00] Second line', '[00:04.50] First line'].join('\n');

  const parsed = LyricsService.parseLrc(lrc);
  assert.strictEqual(parsed.length, 2);
  // offset +500ms shifts everything forward by half a second
  assert.strictEqual(parsed[0].text, 'First line');
  assert.ok(Math.abs(parsed[0].time - 5.0) < 0.001);
  assert.ok(Math.abs(parsed[1].time - 10.5) < 0.001);
});

test('LyricsService.parseLrc strips enhanced word timestamps but keeps text', () => {
  const lrc = '[00:12.00] <00:12.00> Word <00:12.50> by <00:13.00> word';
  const parsed = LyricsService.parseLrc(lrc);
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].text, 'Word by word');
});

test('Auto alignment: constant intro difference shifts the whole grid', () => {
  const lrc = [
    '[00:20.00] Line one',
    '[00:30.00] Line two',
    '[01:00.00] Line three',
    '[01:30.00] Line four',
  ].join('\n');
  const lines = LyricsService.parseLrc(lrc);

  // Наш трек на 10 секунд короче источника (интро порезано) → весь текст раньше
  const shifted = LyricsService.applyAutoAlignment(lines, 200, 190);
  assert.strictEqual(shifted[0].time, 10);
  assert.strictEqual(shifted[3].time, 80);

  // Наш трек на 5 секунд длиннее (вступление растянули) → весь текст позже
  const shiftedLater = LyricsService.applyAutoAlignment(lines, 200, 205);
  assert.strictEqual(shiftedLater[0].time, 25);
});

test('Auto alignment: near-exact and absurd mismatches are left untouched', () => {
  const lrc = ['[00:20.00] A', '[00:40.00] B', '[01:00.00] C', '[01:20.00] D'].join('\n');
  const lines = LyricsService.parseLrc(lrc);

  // Разница меньше 2с — доверяем как есть
  assert.deepStrictEqual(LyricsService.applyAutoAlignment(lines, 200, 201), lines);
  // Разница больше 15с — скорее всего вообще чужая версия, не трогаем
  assert.deepStrictEqual(LyricsService.applyAutoAlignment(lines, 200, 230), lines);
  // Нет длительностей — ничего не делаем
  assert.deepStrictEqual(LyricsService.applyAutoAlignment(lines, null, null), lines);
});

test('Auto alignment: timestamps never go negative after the shift', () => {
  const lrc = [
    '[00:03.00] Early line',
    '[00:10.00] Line two',
    '[00:20.00] Line three',
    '[00:30.00] Line four',
  ].join('\n');
  const lines = LyricsService.parseLrc(lrc);

  const shifted = LyricsService.applyAutoAlignment(lines, 100, 90); // -10s
  assert.strictEqual(shifted.length, 4);
  for (const line of shifted) {
    assert.ok(line.time >= 0, `time must stay non-negative, got ${line.time}`);
  }
});
