import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMultiArtists,
  extractAllArtists,
  parseArtists,
} from '../src/shared/utils/artistParser.ts';

test('Multi-Artist Parser: Splits collaboration strings with &', () => {
  const result = parseMultiArtists('interworld & zxcursed & sadfriendd');
  assert.deepEqual(result, ['interworld', 'zxcursed', 'sadfriendd']);
});

test('Multi-Artist Parser: Splits featuring tags (feat., ft., featuring)', () => {
  const result1 = parseMultiArtists('ThxSoMch feat. Rj Pasin');
  assert.deepEqual(result1, ['ThxSoMch', 'Rj Pasin']);

  const result2 = parseMultiArtists('Drake ft. 21 Savage, Travis Scott');
  assert.deepEqual(result2, ['Drake', '21 Savage', 'Travis Scott']);
});

test('Multi-Artist Parser: Preserves single artists and protected band names', () => {
  assert.deepEqual(parseMultiArtists('Nirvana'), ['Nirvana']);
  assert.deepEqual(parseMultiArtists('AC/DC'), ['AC/DC']);
  assert.deepEqual(parseMultiArtists('Earth, Wind & Fire'), ['Earth, Wind & Fire']);
});

test('Multi-Artist Parser: Handles slash and x separators', () => {
  assert.deepEqual(parseMultiArtists('1nonly x Freddie Dredd'), ['1nonly', 'Freddie Dredd']);
  assert.deepEqual(parseMultiArtists('Artist1 / Artist2 / Artist3'), [
    'Artist1',
    'Artist2',
    'Artist3',
  ]);
});

test('Multi-Artist Parser: Extracts featuring credits embedded in track title', () => {
  const track1 = {
    artist: 'The Weeknd',
    title: 'Save Your Tears (Remix) (feat. Ariana Grande)',
  };
  assert.deepEqual(extractAllArtists(track1), ['The Weeknd', 'Ariana Grande']);

  const track2 = {
    artist: { name: 'Future' },
    title: 'WAIT FOR U (feat. Drake & Tems)',
  };
  assert.deepEqual(extractAllArtists(track2), ['Future', 'Drake', 'Tems']);

  const track3 = {
    artist: 'Miyagi & Andy Panda',
    title: 'Utopia [feat. TumaniYO]',
  };
  assert.deepEqual(extractAllArtists(track3), ['Miyagi', 'Andy Panda', 'TumaniYO']);

  const track4 = {
    artist: 'Скриптонит при уч. 104, T-Fest',
    title: 'Ламбада (уч. Niman)',
  };
  assert.deepEqual(extractAllArtists(track4), ['Скриптонит', '104', 'T-Fest', 'Niman']);

  const track5 = {
    artist: 'Skrillex with Fred again.. vs. Flowdan',
    title: 'Rumble',
  };
  assert.deepEqual(extractAllArtists(track5), ['Skrillex', 'Fred again..', 'Flowdan']);

  const track6 = {
    artist: 'Drake',
    title: 'Passionfruit feat. Jorja Smith',
  };
  assert.deepEqual(extractAllArtists(track6), ['Drake', 'Jorja Smith']);

  const track7 = {
    artist: 'Miyagi&Andy Panda',
    title: 'Fire Man при уч. TumaniYO',
  };
  assert.deepEqual(extractAllArtists(track7), ['Miyagi', 'Andy Panda', 'TumaniYO']);
});
