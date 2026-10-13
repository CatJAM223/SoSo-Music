import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';
import { formatRecordType } from '../src/shared/utils/formatters.ts';
import { normalizeArtistDetails } from '../src/shared/utils/artistParser.ts';
import {
  shouldHaltPlaybackOnConsecutiveErrors,
  shouldRecordListeningStart,
} from '../src/shared/utils/playbackRecovery.ts';
import { shouldRenderTrackRow, isPlayButtonDisabled } from '../src/shared/utils/playerGuards.ts';

test('Audit Fix 1: MusicAggregatorService search contracts on empty or whitespace queries', async () => {
  // Empty query
  const resEmpty = await MusicAggregatorService.search('');
  assert.deepEqual(
    resEmpty,
    { data: [], total: 0 },
    'Empty query must return { data: [], total: 0 }',
  );

  // Whitespace-only query
  const resSpaces = await MusicAggregatorService.search('   ');
  assert.deepEqual(
    resSpaces,
    { data: [], total: 0 },
    'Whitespace query must return { data: [], total: 0 }',
  );

  // Null query cast
  const resNull = await MusicAggregatorService.search(null);
  assert.deepEqual(
    resNull,
    { data: [], total: 0 },
    'Null query must return { data: [], total: 0 }',
  );
});

test('Audit Fix 1b: MusicAggregatorService searchArtists contract on empty or whitespace queries', async () => {
  // Empty artist query
  const resEmpty = await MusicAggregatorService.searchArtists('');
  assert.deepEqual(resEmpty, { data: [] }, 'Empty query must return { data: [] }');

  // Whitespace artist query
  const resSpaces = await MusicAggregatorService.searchArtists('   ');
  assert.deepEqual(resSpaces, { data: [] }, 'Whitespace query must return { data: [] }');

  // Null artist query cast
  const resNull = await MusicAggregatorService.searchArtists(null);
  assert.deepEqual(resNull, { data: [] }, 'Null query must return { data: [] }');
});

test('Audit Fix 2: PlaybackRecovery consecutive playback errors threshold predicate', () => {
  // 1 to 4 consecutive errors: should NOT halt (allows auto-skip to next tracks)
  for (let errors = 0; errors < 5; errors++) {
    assert.equal(
      shouldHaltPlaybackOnConsecutiveErrors(errors, 5),
      false,
      `Error count ${errors} should not halt playback`,
    );
  }

  // 5 or more consecutive errors: MUST halt (break error cascade)
  assert.equal(shouldHaltPlaybackOnConsecutiveErrors(5, 5), true);
  assert.equal(shouldHaltPlaybackOnConsecutiveErrors(6, 5), true);
  assert.equal(shouldHaltPlaybackOnConsecutiveErrors(10, 5), true);
});

test('Playback history records new starts and repeats, but ignores pause/resume', () => {
  assert.equal(shouldRecordListeningStart(12, -1), true);
  assert.equal(shouldRecordListeningStart(12, 12), false);
  assert.equal(shouldRecordListeningStart(13, 12), true);
  assert.equal(shouldRecordListeningStart(13, -1), true);
});

test('Audit Fix 3a: TrackRow guard condition validation (using production playerGuards)', () => {
  assert.equal(shouldRenderTrackRow(null), false);
  assert.equal(shouldRenderTrackRow(undefined), false);
  assert.equal(shouldRenderTrackRow({}), false);
  assert.equal(shouldRenderTrackRow({ title: 'Song' }), false);
  assert.equal(shouldRenderTrackRow({ id: 'trk_1', title: 'Song' }), true);
  assert.equal(shouldRenderTrackRow({ id: 12345, title: 'Song' }), true);
});

test('Audit Fix 3b: useArtistViewModel data normalization preserves arrays (using production normalizeArtistDetails)', () => {
  // Case 1: Corrupted or null fields from API
  const dirty1 = { artist: { id: 1, name: 'Test' }, topTracks: null, albums: undefined };
  const clean1 = normalizeArtistDetails(dirty1);
  assert.ok(Array.isArray(clean1.topTracks));
  assert.equal(clean1.topTracks.length, 0);
  assert.ok(Array.isArray(clean1.albums));
  assert.equal(clean1.albums.length, 0);

  // Case 2: Valid arrays are preserved
  const valid = {
    artist: { id: 2, name: 'Valid' },
    topTracks: [{ id: 't1', title: 'Track 1' }],
    albums: [{ id: 'a1', title: 'Album 1' }],
  };
  const clean2 = normalizeArtistDetails(valid);
  assert.equal(clean2.topTracks.length, 1);
  assert.equal(clean2.albums.length, 1);
});

test('Audit Fix 3c: Album view model formatRecordType helper (using production formatRecordType)', () => {
  assert.equal(formatRecordType(undefined), 'Альбом');
  assert.equal(formatRecordType(''), 'Альбом');
  assert.equal(formatRecordType('single'), 'Сингл');
  assert.equal(formatRecordType('ep'), 'EP');
  assert.equal(formatRecordType('compilation'), 'Сборник');
  assert.equal(formatRecordType('podcast'), 'Подкаст');
  assert.equal(formatRecordType('album'), 'Альбом');
  assert.equal(formatRecordType('live'), 'Live');
});

test('Audit Fix 3d: PlayerBar Play button activation logic (using production isPlayButtonDisabled)', () => {
  // Empty player state (no track, no snippet, no queue) -> Disabled
  assert.equal(isPlayButtonDisabled(null, false, []), true);
  assert.equal(isPlayButtonDisabled(undefined, false, []), true);

  // Queue loaded but playback not started -> Enabled!
  assert.equal(isPlayButtonDisabled(null, false, [{ id: 1, title: 'In Queue' }]), false);

  // Currently playing track -> Enabled
  assert.equal(isPlayButtonDisabled({ id: 1, title: 'Playing' }, false, []), false);

  // Snippet preview playing -> Enabled
  assert.equal(isPlayButtonDisabled(null, true, []), false);
});
