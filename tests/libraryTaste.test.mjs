import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSqliteRuntime } from '../src/desktop/main/db/sqliteRuntime.ts';
import { initializeLibrarySchema } from '../src/desktop/main/db/schema.ts';
import { LibraryTasteService } from '../src/desktop/main/services/libraryTaste.ts';
import { LibraryTasteStore } from '../src/desktop/main/services/libraryTasteStore.ts';
import {
  libraryTasteKey,
  lastFmTrackTitle,
  libraryGenreNames,
  summarizeLibraryGenres,
} from '../src/shared/utils/libraryTaste.ts';
import { sequenceWaveTracks } from '../src/shared/utils/waveQueue.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';
import { setDesktopFetch } from '../src/desktop/main/services/desktopFetch.ts';
import { registerLibraryTasteHandlers } from '../src/desktop/main/ipc/libraryTasteHandlers.ts';
import { registerLibraryHandlers } from '../src/desktop/main/ipc/libraryHandlers.ts';
import { registerPlaylistHandlers } from '../src/desktop/main/ipc/playlistHandlers.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { hookRuntime } from './helpers/hookRuntime.mjs';

const SQL = await loadSqliteRuntime(process.cwd());
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function settled(service) {
  for (let attempt = 0; attempt < 5000 && service.report().running; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(service.report().running, false, 'Analysis must complete');
  return service.report();
}
function fixture(t, lookup = async () => ['nu metal']) {
  const db = new SQL.Database();
  initializeLibrarySchema(db);
  const calls = [];
  const service = new LibraryTasteService(
    () => db,
    () => {},
    async (...args) => {
      calls.push(args.slice(0, 2));
      return lookup(...args);
    },
    0,
  );
  const add = (id, artist = 'Artist', title = 'Song ' + id, liked = true) => {
    if (liked)
      db.run('INSERT INTO liked_tracks(deezer_id,title,artist) VALUES(?,?,?)', [id, title, artist]);
    else
      db.run(
        'INSERT INTO playlist_tracks(playlist_id,track_deezer_id,title,artist,position) VALUES(?,?,?,?,?)',
        ['playlist', id, title, artist, 1],
      );
  };
  t.after(() => {
    service.dispose();
    db.close();
  });
  return {
    db,
    service,
    calls,
    add,
    store: new LibraryTasteStore(
      () => db,
      () => {},
    ),
  };
}

test('Library analysis covers every saved row, combines provider/playlist copies and excludes dislikes', async (t) => {
  const f = fixture(t);
  for (let index = 0; index < 70; index++) f.add(String(index), 'Artist ' + index);
  f.add('yt_duplicate', 'Artist 0', 'Song 0', false);
  f.add('blocked', 'Blocked', 'Never', false);
  f.db.run('INSERT INTO disliked_tracks(track_id,title,artist) VALUES(?,?,?)', [
    'blocked',
    'Never',
    'Blocked',
  ]);
  assert.equal(f.service.analyze().totalTracks, 70);
  const report = await settled(f.service);
  assert.equal(report.matchedTracks, 70);
  assert.equal(report.processedTracks, 70);
  assert.equal(f.calls.length, 70);
  assert.equal(report.genres.find((genre) => genre.name === 'nu metal').tracks, 70);
  assert.ok(!f.calls.some(([artist]) => artist === 'Blocked'));
});

test('Last.fm lookup strips provider decoration, preserves variants, filters non-genres and falls back to artist only when needed', async (t) => {
  const f = fixture(t, async (_artist, title) =>
    title ? ['seen live', '2020', 'favorites'] : ['grunge', 'rock'],
  );
  f.add('a', 'Nirvana', 'Nirvana - Come As You Are (Official Video)');
  f.add('b', 'Nirvana', 'Lithium');
  await settledAfterStart(f.service);
  assert.deepEqual(f.calls, [
    ['Nirvana', 'Come As You Are'],
    ['Nirvana', undefined],
    ['Nirvana', 'Lithium'],
  ]);
  assert.equal(f.service.report().matchedTracks, 2);
  assert.deepEqual(libraryGenreNames(['seen live', '2020', 'female vocalists']), []);
  assert.equal(lastFmTrackTitle('Song (Remix)', 'Artist'), 'Song (Remix)');
  assert.notEqual(
    libraryTasteKey({ artist: 'Artist', title: 'Song' }),
    libraryTasteKey({ artist: 'Artist', title: 'Song (Remix)' }),
  );
});
async function settledAfterStart(service) {
  service.analyze();
  return settled(service);
}

test('Successful and empty tag results persist across restarts and current library membership determines taste', async (t) => {
  const f = fixture(t, async (artist) => (artist === 'Missing' ? [] : ['grunge']));
  f.add('a', 'Nirvana');
  f.add('b', 'Missing');
  await settledAfterStart(f.service);
  assert.equal(f.service.report().missingTracks, 1);
  const copy = new SQL.Database(f.db.export());
  const restored = new LibraryTasteService(
    () => copy,
    () => {},
    async () => {
      throw Error('Cache should avoid requests');
    },
    0,
  );
  t.after(() => {
    restored.dispose();
    copy.close();
  });
  assert.equal(restored.analyze().running, false);
  assert.equal(restored.report().matchedTracks, 1);
  copy.run("DELETE FROM liked_tracks WHERE deezer_id='a'");
  assert.deepEqual(restored.report().genres, []);
  assert.equal(restored.report().totalTracks, 1);
});

test('Network errors remain retryable and do not overwrite a known taste with an empty result', async (t) => {
  let unavailable = false;
  const f = fixture(t, async () => {
    if (unavailable) throw Error('HTTP 403');
    return ['grunge'];
  });
  f.add('a');
  await settledAfterStart(f.service);
  f.db.run('UPDATE library_genre_tags SET updated_at=0');
  unavailable = true;
  let report = await settledAfterStart(f.service);
  assert.equal(report.failedTracks, 1);
  assert.equal(report.matchedTracks, 1);
  assert.ok(report.error);
  assert.equal(f.db.exec('SELECT updated_at FROM library_genre_tags')[0].values[0][0], 0);
  unavailable = false;
  report = await settledAfterStart(f.service);
  assert.equal(report.failedTracks, 0);
  assert.equal(report.error, undefined);
  assert.equal(report.matchedTracks, 1);
});

test('Cancellation aborts in-flight lookups and discards late results', async (t) => {
  let release, signal;
  const f = fixture(t, async (_artist, _title, ownerSignal) => {
    signal = ownerSignal;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  f.add('a');
  f.service.analyze();
  f.service.cancel();
  assert.equal(signal.aborted, true);
  release(['metal']);
  await settled(f.service);
  assert.equal(f.service.report().matchedTracks, 0);
  assert.deepEqual(f.service.report().genres, []);
});

test('Automatic analysis is opt-in, survives restart, analyzes additions immediately and queues additions during a run', async (t) => {
  let release;
  const f = fixture(t, async (_artist, title) =>
    title === 'Song a'
      ? new Promise((resolve) => {
          release = resolve;
        })
      : ['jazz'],
  );
  f.add('a');
  f.service.libraryChanged();
  assert.equal(f.calls.length, 0);
  f.service.setAutoAnalyze(true);
  assert.equal(f.calls.length, 1);
  f.add('b', 'Second');
  f.service.libraryChanged();
  f.service.libraryChanged();
  release(['rock']);
  await settled(f.service);
  assert.equal(f.calls.length, 2);
  assert.equal(f.service.report().matchedTracks, 2);
  assert.equal(
    new LibraryTasteStore(
      () => f.db,
      () => {},
    ).autoAnalyze,
    true,
  );
  f.service.setAutoAnalyze(false);
  f.add('c');
  f.service.libraryChanged();
  assert.equal(f.calls.length, 2);
});

test('Fresh cached tracks are reused while expired data is refreshed on manual analysis', async (t) => {
  const f = fixture(t);
  f.add('a');
  await settledAfterStart(f.service);
  f.service.analyze();
  assert.equal(f.calls.length, 1);
  f.db.run('UPDATE library_genre_tags SET updated_at=0');
  await settledAfterStart(f.service);
  assert.equal(f.calls.length, 2);
});

test('Favorite weights exceed playlist weights and one huge artist discography has bounded influence', () => {
  const library = [
    { id: 'like', title: 'Loved', artist: 'Liked', liked: true },
    { id: 'playlist', title: 'Added', artist: 'Weak', liked: false },
  ];
  const profile = summarizeLibraryGenres(library, (track) => [track.liked ? 'grunge' : 'jazz']);
  assert.equal(profile[0].name, 'grunge');
  assert.equal(profile[0].share, 0.8);
  const huge = Array.from({ length: 1000 }, (_, index) => ({
    id: String(index),
    title: 'Song ' + index,
    artist: 'Huge',
    liked: true,
  }));
  const balanced = summarizeLibraryGenres(
    [
      ...huge,
      ...Array.from({ length: 4 }, (_, index) => ({
        ...library[0],
        id: 'like' + index,
        artist: 'Other ' + index,
      })),
    ],
    (track) => [track.artist === 'Huge' ? 'metal' : 'jazz'],
  );
  assert.equal(balanced[0].name, 'jazz');
});

test('Last.fm API parses arrays and single tag objects, treats absent tracks as missing, and propagates access/transport errors', async (t) => {
  LastFmService.configureApiKey('00000000000000000000000000000001');
  t.after(() => LastFmService.configureApiKey(''));
  t.after(() => setDesktopFetch(null));
  const requests = [];
  setDesktopFetch(async (url) => {
    requests.push(new URL(url));
    return Response.json({
      toptags: {
        tag: [
          { name: 'Nu Metal', count: '100' },
          { name: 'seen live', count: 0 },
        ],
      },
    });
  });
  assert.deepEqual(await LastFmService.getTopTags('Linkin Park', 'Numb'), ['Nu Metal']);
  assert.equal(requests[0].searchParams.get('method'), 'track.getTopTags');
  setDesktopFetch(async () => Response.json({ toptags: { tag: { name: 'Grunge', count: '70' } } }));
  assert.deepEqual(await LastFmService.getTopTags('Nirvana'), ['Grunge']);
  setDesktopFetch(async () => Response.json({ error: 6, message: 'Track not found' }));
  assert.deepEqual(await LastFmService.getTopTags('Unknown', 'Unknown'), []);
  setDesktopFetch(async () => Response.json({ error: 10, message: 'Invalid API key' }));
  await assert.rejects(LastFmService.getTopTags('Artist'), /Invalid API key/);
  setDesktopFetch(async () => new Response('Denied', { status: 403 }));
  await assert.rejects(LastFmService.getTopTags('Artist'));
});

test('Main-window IPC validates automatic-analysis arguments and untrusted senders', () => {
  const handlers = new Map(),
    webContents = { mainFrame: {} };
  const win = { webContents, isDestroyed: () => false };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  let auto;
  registerLibraryTasteHandlers(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    () => win,
    {
      report: () => ({ running: false }),
      analyze: () => ({ running: true }),
      cancel: () => ({ running: false }),
      setAutoAnalyze: (enabled) => {
        auto = enabled;
        return {};
      },
    },
  );
  assert.equal(handlers.get('libraryTaste:analyze')(event).running, true);
  handlers.get('libraryTaste:setAutoAnalyze')(event, true);
  assert.equal(auto, true);
  assert.throws(() => handlers.get('libraryTaste:setAutoAnalyze')(event, 'true'));
  assert.throws(() => handlers.get('libraryTaste:analyze')({ ...event, senderFrame: {} }));
});

test('Like and playlist mutation handlers notify automatic analysis after the library update', () => {
  const handlers = new Map(),
    events = [];
  const ipc = { handle: (channel, handler) => handlers.set(channel, handler) };
  const db = {
    toggleLikeTrack: () => {
      events.push('like');
      return true;
    },
    addTrackToPlaylist: () => {
      events.push('playlist');
      return true;
    },
  };
  registerLibraryHandlers(ipc, db, () => events.push('changed'));
  registerPlaylistHandlers(ipc, db, () => events.push('changed'));
  handlers.get('db:toggleLikeTrack')({}, {});
  handlers.get('db:addTrackToPlaylist')({}, 'playlist', {});
  assert.deepEqual(events, ['like', 'changed', 'playlist', 'changed']);
});

test('Full-library genre distribution changes wave ordering and survives renderer refinement', () => {
  const song = (id, tags) => ({
    id,
    title: 'Song ' + id,
    artist: { name: 'Artist ' + id },
    album: { title: '' },
    duration: 200,
    preview: '',
    source: 'youtube',
    tags,
  });
  const pool = [song('jazz', ['jazz']), song('grunge', ['grunge'])];
  const genres = [{ name: 'grunge', share: 0.8, tracks: 200 }];
  assert.equal(
    sequenceWaveTracks(pool, 'default', [], 2, { libraryGenres: genres })[0].id,
    'grunge',
  );
  assert.equal(
    sequenceWaveTracks(
      pool.map((track) => ({ ...track, waveGenreScore: track.id === 'grunge' ? 2.4 : 0 })),
      'default',
      [],
      2,
    )[0].id,
    'grunge',
  );
});

test('Wave engine consumes Last.fm metadata and carries bounded genre affinity without audio model features', async (t) => {
  const f = fixture(t);
  f.add('a');
  await settledAfterStart(f.service);
  const song = (id, tags) => ({
    id,
    title: 'Melody ' + id,
    artist: { name: 'Known' },
    album: { title: '' },
    duration: 200,
    preview: '',
    source: 'soundcloud',
    tags,
  });
  t.mock.method(SoundCloudService, 'search', async () => ({
    data: [song('jazz', ['jazz']), song('metal', ['nu metal'])],
  }));
  t.mock.method(YouTubeMusicService, 'search', async () => ({ data: [] }));
  t.mock.method(LastFmService, 'getGenreTracks', async () => []);
  WaveEngine.setTasteProvider(f.service);
  t.after(() => WaveEngine.setTasteProvider(undefined));
  const tracks = await WaveEngine.getWaveBatch('mix', [song('seed', [])], [], [], [], {}, false);
  assert.equal(tracks[0].id, 'metal');
  assert.equal(tracks[0].waveGenreScore, 6);
  assert.ok(tracks.every((track) => !Object.hasOwn(track, 'waveAudio')));
});

test('Settings hook stops polling and ignores late responses after closing', async () => {
  let reply;
  const window = {
    electronAPI: {
      getLibraryTaste: () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    },
  };
  const runtime = hookRuntime(
    new URL('../src/shared/hooks/useLibraryTaste.ts', import.meta.url),
    {},
    { window },
  );
  runtime.render(true);
  runtime.unmount();
  reply({ genres: [] });
  await turn();
  assert.equal(runtime.timers(), 0);
  assert.equal(runtime.lateUpdates(), 0);
});

test('Cancelling automatic analysis leaves cancelled records paused but new additions still analyze immediately', async (t) => {
  let release;
  const f = fixture(t, async (_artist, title) =>
    title === 'Song a'
      ? new Promise((resolve) => {
          release = resolve;
        })
      : ['jazz'],
  );
  f.add('a');
  f.service.setAutoAnalyze(true);
  f.service.cancel();
  release(['rock']);
  await turn();
  f.service.libraryChanged();
  assert.equal(f.calls.length, 1);
  f.add('b', 'New artist');
  f.service.libraryChanged();
  await settled(f.service);
  assert.equal(f.calls.length, 2);
  assert.equal(f.service.report().matchedTracks, 1);
});

test('An older status response cannot revert an automatic-analysis toggle', async () => {
  let reply;
  const report = { autoAnalyze: false, genres: [] };
  const window = {
    electronAPI: {
      getLibraryTaste: () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
      setLibraryTasteAutoAnalyze: async () => ({ ...report, autoAnalyze: true }),
    },
  };
  const runtime = hookRuntime(
    new URL('../src/shared/hooks/useLibraryTaste.ts', import.meta.url),
    {},
    { window },
  );
  runtime.render(true);
  await runtime.api().run('auto', true);
  runtime.render();
  reply(report);
  await runtime.flush();
  assert.equal(runtime.api().report.autoAnalyze, true);
  runtime.unmount();
  assert.equal(runtime.timers(), 0);
});

test('An empty track lookup still uses known Last.fm artist genres when enriching wave candidates', (t) => {
  const f = fixture(t);
  const saved = { title: 'Unknown Recording', artist: 'Known Artist' };
  f.store.put(libraryTasteKey(saved), []);
  f.store.put('artist:known artist', ['grunge']);
  const [candidate] = f.service.enrichCached([
    { id: 'yt_unknown', title: saved.title, artist: { name: saved.artist }, tags: ['rock'] },
  ]);
  assert.deepEqual(candidate.tags, ['grunge', 'rock']);
});
