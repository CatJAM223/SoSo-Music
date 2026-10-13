import { test } from 'node:test';
import assert from 'node:assert/strict';

import { transposeChordsInText, transposeNote } from '../src/shared/utils/chordTransposer.ts';

test('Chords: Transposes basic chords up and down accurately', () => {
  const input = '[ch]Am[/ch] [ch]C[/ch] [ch]D[/ch] [ch]F[/ch]';
  const transposedUp2 = transposeChordsInText(input, 2);
  assert.equal(transposedUp2, '[ch]Bm[/ch] [ch]D[/ch] [ch]E[/ch] [ch]G[/ch]');

  const transposedDown1 = transposeChordsInText(input, -1);
  assert.equal(transposedDown1, '[ch]G#m[/ch] [ch]B[/ch] [ch]C#[/ch] [ch]E[/ch]');
});

test('Chords: Transposes complex slash and 7th chords correctly', () => {
  const input = '[ch]F#m7/C#[/ch] and [ch]Cadd9[/ch]';
  const transposedUp1 = transposeChordsInText(input, 1);
  assert.equal(transposedUp1, '[ch]Gm7/D[/ch] and [ch]C#add9[/ch]');
});

test('Chords: Retains section headers and non-chord lyrics intact', () => {
  const input = '[Verse 1]\n[ch]Em[/ch] Hello world [ch]G[/ch]';
  const transposed = transposeChordsInText(input, 3);
  assert.equal(transposed, '[Verse 1]\n[ch]Gm[/ch] Hello world [ch]A#[/ch]');
});
