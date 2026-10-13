import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesImportedRecording } from '../src/shared/utils/recordingIdentity.ts';
const wanted = { title: 'Song', artist: { name: 'Artist' }, duration: 180 };
test('Imported recording identity accepts exact or explicitly credited uploads and modest duration drift', () => {
  assert.equal(
    matchesImportedRecording(wanted, {
      title: 'Song (Official Audio)',
      artist: 'Artist',
      duration: 184,
    }),
    true,
  );
  assert.equal(
    matchesImportedRecording(wanted, { title: 'Artist - Song', artist: 'Uploader', duration: 180 }),
    true,
  );
  assert.equal(
    matchesImportedRecording(
      { title: 'Зоопарк', artist: 'Гражданская оборона' },
      { title: 'Зоопарк', artist: 'Гражданская Оборона' },
    ),
    true,
  );
});
test('Imported recording identity rejects different artists, live/speed variants, missing credits and wrong duration', () => {
  for (const candidate of [
    { title: 'Song', artist: 'Other' },
    { title: 'Song (Live)', artist: 'Artist' },
    { title: 'Song (Sped Up)', artist: 'Artist' },
    { title: 'Song', artist: 'Artist', duration: 90 },
    { title: 'Song' },
  ])
    assert.equal(matchesImportedRecording(wanted, candidate), false);
  assert.equal(matchesImportedRecording({ title: 'Song' }, wanted), false);
});
