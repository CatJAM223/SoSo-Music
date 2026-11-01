import test from 'node:test';
import assert from 'node:assert/strict';
import { getCuratedWaveArtist } from '../src/shared/utils/waveQueue.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';
import { getWaveArtistNames } from '../src/shared/utils/waveIdentity.ts';
import {
  createDailyRecommendationLoader,
  selectDailyRecommendations,
} from '../src/shared/utils/dailyRecommendations.ts';
import { DatabaseManager } from '../src/desktop/main/db/index.ts';
import { albumMatchScore } from '../src/shared/compute/albumSelection.ts';

const track = (
  id,
  artist = 'Example Artist',
  title = 'Distinct melody ' + id,
  source = 'soundcloud',
) => ({
  id,
  title,
  artist: { name: artist },
  duration: 200,
  source,
  album: { title: '' },
  preview: '',
});
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
};

test('exclusions beyond the first ten results trigger bounded deeper searches', async (t) => {
  const catalog = Array.from({ length: 30 }, (_, i) => track(String(i + 1)));
  const limits = [];
  t.mock.method(SoundCloudService, 'search', async (_q, n) => {
    limits.push(n);
    return { data: catalog.slice(0, n) };
  });
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
  t.mock.method(SoundCloudService, 'getRelatedTracks', async () => []);
  t.mock.method(LastFmService, 'getSimilarArtists', async () => []);
  const result = await WaveEngine.getWaveBatch(
    'mix',
    [track('999')],
    catalog.slice(0, 10).map((t) => t.id),
    [],
    [],
    {},
    false,
  );
  assert.ok(result.length > 0);
  assert.ok(result.every((t) => Number(t.id) > 10));
  assert.ok(limits.some((n) => n > 10));
  assert.ok(limits.every((n) => n <= 40));
  assert.ok(limits.length <= 3);
});

test('all-source cold start can use YouTube when SoundCloud is empty; source selection remains strict', async (t) => {
  let youtubeCalls = 0;
  t.mock.method(SoundCloudService, 'search', async () => ({ data: [] }));
  t.mock.method(YouTubeMusicService, 'search', async (query) => {
    youtubeCalls++;
    return {
      data: [track('yt_abcdefghijk', getCuratedWaveArtist(query), 'New constellation', 'youtube')],
    };
  });
  const result = await WaveEngine.getWaveBatch('default', [], [], [], [], { source: 'all' }, false);
  assert.ok(youtubeCalls > 0);
  assert.equal(result[0].source, 'youtube');
  youtubeCalls = 0;
  const strict = await WaveEngine.getWaveBatch(
    'default',
    [],
    [],
    [],
    [],
    { source: 'soundcloud' },
    false,
  );
  assert.equal(youtubeCalls, 0);
  assert.equal(strict.length, 0);
});

test('same-day refill preserves current cards on success and failure, while midnight excludes them', async () => {
  let stamp = new Date(2026, 9, 31, 12).getTime(),
    calls = 0;
  const first = track('first'),
    second = track('second', 'Second Artist');
  const requests = [];
  const load = createDailyRecommendationLoader(
    storage(),
    async (ids, previous, options) => {
      requests.push({ ids, previous, options });
      calls++;
      if (calls === 1) return [first];
      if (calls === 2) throw Error('Offline');
      if (calls === 3) return [second];
      return [];
    },
    () => new Date(stamp),
  );
  assert.deepEqual(
    (await load()).tracks.map((t) => t.id),
    ['first'],
  );
  stamp += 300000;
  assert.deepEqual(
    (await load()).tracks.map((t) => t.id),
    ['first'],
  );
  assert.deepEqual(requests[1].ids, []);
  assert.equal(requests[1].options.retainedTracks[0].id, 'first');
  stamp += 300000;
  assert.deepEqual(
    (await load()).tracks.map((t) => t.id),
    ['first', 'second'],
  );
  stamp = new Date(2026, 10, 1, 0, 0, 1).getTime();
  assert.deepEqual((await load()).tracks, []);
  assert.deepEqual(requests[3].ids, ['first', 'second']);
  assert.deepEqual(requests[3].options.retainedTracks, []);
});

test('retained cards have priority even when new artists have less negative feedback', () => {
  const retained = track('kept', 'Rejected Artist', 'Retained constellation');
  const fresh = Array.from({ length: 5 }, (_, i) => track('fresh' + i, 'Fresh Artist ' + i));
  const rejected = [
    { id: 'bad', artist: 'Rejected Artist', title: 'Different rejected recording' },
  ];
  const result = selectDailyRecommendations([retained, ...fresh], [], rejected, 1);
  assert.equal(result[0].id, 'kept');
  assert.equal(result.length, 5);
  const second = track('kept2', 'Rejected Artist', 'Another retained melody');
  assert.deepEqual(
    selectDailyRecommendations([retained, second, ...fresh], [], rejected, 2)
      .slice(0, 2)
      .map((t) => t.id),
    ['kept', 'kept2'],
  );
});

test('source changes partition daily caches and never carry disabled-source cards into the replacement', async () => {
  const requests = [];
  const load = createDailyRecommendationLoader(
    storage(),
    async (_ids, _previous, options) => {
      requests.push(options);
      return options.source === 'all'
        ? [track('yt_one', 'YT Artist', 'YouTube melody', 'youtube')]
        : [track('sc_one')];
    },
    () => new Date(2026, 9, 31, 12),
  );
  assert.equal((await load('', 'all')).tracks[0].source, 'youtube');
  assert.equal((await load('', 'soundcloud')).tracks[0].source, 'soundcloud');
  assert.deepEqual(requests[1].retainedTracks, []);
  assert.equal(requests.length, 2);
});

test('exact album matches outrank earlier Deluxe entries and incompatible editions are rejected', async (t) => {
  t.mock.method(MusicAggregatorService, 'getArtist', async () => ({
    albums: [
      { id: 'sc_alb_2', title: 'Example Album Deluxe' },
      { id: 'sc_alb_1', title: 'Example Album' },
    ],
  }));
  t.mock.method(SoundCloudService, 'getAlbumTracks', async (id, title) => [
    track(String(id), 'Example Artist', title),
  ]);
  const result = await MusicAggregatorService.getAlbumTracks(
    undefined,
    'Example Album',
    'Example Artist',
  );
  assert.equal(result[0].id, 'sc_alb_1');
  assert.equal(albumMatchScore('Example Album', 'Example Album Deluxe'), 0);
  assert.equal(albumMatchScore('Example Album', 'Example Album (Remastered)'), 0);
  assert.ok(albumMatchScore('日本語', '日本語') > 0);
  assert.ok(albumMatchScore('Example Album', 'Example Album Edition') > 0);
});

test('band names survive conjunctions while explicit collaborator credits are still recognized', () => {
  for (const name of ['Маша и Медведи', 'Король и Шут', 'AC/DC'])
    assert.deepEqual(getWaveArtistNames(name), [name]);
  assert.deepEqual(getWaveArtistNames('Маша и Медведи feat. Guest'), ['Маша и Медведи', 'Guest']);
});

test('taste recency changes recommendations without changing scrobbles; excluded sessions remain neutral', async (t) => {
  const manager = new DatabaseManager(':memory:');
  await manager.init();
  t.after(() => manager.db.close());
  manager.recordPlaybackSession({
    sessionId: 'old',
    track: track('old', 'Old Artist'),
    playedSeconds: 200,
    completed: true,
  });
  manager.db.run(
    "UPDATE playback_sessions SET started_at=datetime('now','-720 days') WHERE session_id='old'",
  );
  manager.db.run(
    "UPDATE track_scrobbles SET last_played_at=datetime('now','-720 days') WHERE track_id='old'",
  );
  manager.recordPlaybackSession({
    sessionId: 'recent',
    track: track('recent', 'Recent Artist'),
    playedSeconds: 200,
    completed: true,
  });
  manager.db.run("INSERT INTO playlists(id,name) VALUES('ignored','Ignored')");
  manager.setTasteExcluded({ scope: 'playlist', id: 'ignored', excluded: true });
  manager.recordPlaybackSession({
    sessionId: 'ignored-session',
    track: track('ignored-song', 'Ignored Artist'),
    playedSeconds: 200,
    completed: true,
    origin: { kind: 'playlist', id: 'ignored' },
  });
  const before = manager.db.exec('SELECT * FROM track_scrobbles ORDER BY track_id');
  assert.equal(manager.getWaveTasteTracks(1)[0].id, 'recent');
  const artists = manager.getScrobbledTopArtists();
  assert.equal(artists[0].name, 'Recent Artist');
  assert.ok(!artists.some((a) => a.name === 'Ignored Artist'));
  assert.deepEqual(manager.db.exec('SELECT * FROM track_scrobbles ORDER BY track_id'), before);
});
