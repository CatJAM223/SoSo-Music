import test from 'node:test';
import assert from 'node:assert/strict';
import { waveMusicProfile, waveMusicMetadata } from '../src/shared/utils/waveMusicProfile.ts';
import { sequenceWaveTracks, resequenceWaveQueue } from '../src/shared/utils/waveQueue.ts';
import { mergeWaveTasteSeeds } from '../src/shared/utils/waveTaste.ts';
import {
  normalizeWaveBatchContext,
  selectWaveMoodSeeds,
  waveQueueContext,
} from '../src/shared/utils/waveRecommendations.ts';
import { waveMemoryTrack, createWaveMemory } from '../src/shared/services/waveMemory.ts';
import { gatherWaveDiscovery } from '../src/shared/services/waveDiscovery.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';

const song = (id, genre, tags = [], artist = `Musician ${id}`) => ({
  id: String(id),
  title: `Melody ${id}`,
  artist: { name: artist },
  album: { title: 'Single' },
  duration: 200,
  preview: '',
  source: 'soundcloud',
  genre,
  tags,
});

test('The same candidate pool produces energetic and calm openings, while metadata-free songs remain eligible', () => {
  const calm = song('1', 'Ambient'),
    active = song('2', 'Metal'),
    unknown = song('3');
  for (const pool of [
    [calm, active, unknown],
    [unknown, active, calm],
  ]) {
    assert.equal(sequenceWaveTracks(pool, 'energy', [], 3)[0].id, active.id);
    assert.equal(sequenceWaveTracks(pool, 'chill', [], 3)[0].id, calm.id);
    assert.deepEqual(
      new Set(sequenceWaveTracks(pool, 'energy', [], 3).map((t) => t.id)),
      new Set(['1', '2', '3']),
    );
  }
});

test('Music classification uses bounded provider tags, never artist names or suggestive song titles', () => {
  const misleading = {
    ...song('1'),
    title: 'Ambient relaxed calm',
    artist: { name: 'Metal Punk' },
  };
  assert.equal(waveMusicProfile(misleading).energy, 0);
  assert.equal(waveMusicProfile(misleading).styles.size, 0);
  assert.equal(waveMusicProfile(song('2', 'Metallic')).styles.size, 0);
  assert.equal(waveMusicProfile(song('3', 'Hip-Hop')).styles.has('hip hop'), true);
  assert.equal(waveMusicProfile(song('4', 'HIP HOP')).styles.has('hip hop'), true);
  assert.equal(waveMusicProfile(song('5', 'Эмбиент')).energy, -1);
});

test('Durable taste supports several genres and a recent successful song redirects new-artist discovery', () => {
  const jazz = song('jazz', 'Jazz'),
    rock = song('rock', 'Rock'),
    other = song('other', 'Country');
  const taste = [song('liked-rock', 'Rock'), song('liked-jazz', 'Jazz')];
  const options = {
    tasteTracks: taste,
    positiveTracks: [song('session-jazz', 'Jazz')],
  };
  assert.equal(sequenceWaveTracks([other, rock, jazz], 'default', [], 3, options)[0].id, jazz.id);
  const durable = sequenceWaveTracks([other, jazz, rock], 'default', [], 3, {
    tasteTracks: taste,
  });
  assert.equal(durable[0].id, jazz.id);
  assert.ok(
    durable.findIndex((t) => t.id === rock.id) < durable.findIndex((t) => t.id === other.id),
  );
});

test('A skipped style temporarily loses priority across artists; positive listening counterbalances the detour', () => {
  const jazz = song('jazz', 'Jazz'),
    rock = song('rock', 'Rock'),
    skipped = song('skip', 'Jazz');
  assert.equal(
    sequenceWaveTracks([jazz, rock], 'default', [], 2, {
      skippedTracks: [skipped],
    })[0].id,
    rock.id,
  );
  const recovered = sequenceWaveTracks([jazz, rock], 'default', [], 2, {
    skippedTracks: [skipped],
    positiveTracks: [song('success', 'Jazz')],
  });
  assert.equal(recovered[0].id, jazz.id);
  assert.ok(recovered.some((t) => t.id === rock.id));
});

test('Coherence crosses batch boundaries and follows the last heard song rather than a skipped one', () => {
  const jazz = song('next-jazz', 'Jazz'),
    rock = song('next-rock', 'Rock');
  const previous = song('heard', 'Jazz'),
    skip = song('skip', 'Rock');
  assert.equal(
    sequenceWaveTracks([rock, jazz], 'default', [], 2, {
      recentTracks: [previous],
    })[0].id,
    jazz.id,
  );
  assert.equal(
    sequenceWaveTracks([rock, jazz], 'default', [], 2, {
      recentTracks: [previous, skip],
      skippedTracks: [skip],
    })[0].id,
    jazz.id,
  );
});

test('Genre similarity cannot resurrect heard recordings or promote edits over their ordinary version', () => {
  const heard = song('heard', 'Jazz', [], 'Known Artist');
  const copy = { ...heard, id: 'copy' };
  const ordinary = song('ordinary', 'Rock', [], 'Other Artist');
  const edit = {
    ...ordinary,
    id: 'edit',
    title: ordinary.title + ' (Slowed)',
    genre: 'Jazz',
  };
  const result = sequenceWaveTracks([copy, edit, ordinary], 'default', [], 25, {
    recentTracks: [heard],
    positiveTracks: [song('success', 'Jazz')],
  });
  assert.deepEqual(
    result.map((t) => t.id),
    [ordinary.id],
  );
});

test('Musical context survives seed merging, persistent history and IPC, with metadata and URLs bounded', () => {
  const tagged = {
    ...song(
      'sc_10',
      'g'.repeat(500),
      Array.from({ length: 50 }, (_, i) => `tag-${i}-` + 'x'.repeat(200)),
    ),
    resolvedStreamUrl: 'https://signed.invalid/audio',
    cover_url: 'https://cover.invalid/',
  };
  const seed = mergeWaveTasteSeeds([tagged], [], [])[0];
  assert.equal(seed.genre.length, 100);
  assert.equal(seed.tags.length, 16);
  assert.equal(seed.tags[0].length, 80);
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    };
  createWaveMemory(storage).recordPlayback(tagged, 10);
  const stored = createWaveMemory(storage).playedTracks()[0];
  const context = normalizeWaveBatchContext({
    positiveTracks: Array.from({ length: 30 }, (_, i) => ({
      ...tagged,
      id: String(i),
    })),
    skippedTracks: [tagged],
    recentTracks: [stored],
  });
  assert.equal(context.positiveTracks.length, 12);
  assert.equal(context.positiveTracks[0].id, '0');
  assert.equal(context.positiveTracks[11].id, '11');
  for (const track of [seed, stored, context.skippedTracks[0], waveMemoryTrack(tagged)]) {
    assert.equal(track.genre.length, 100);
    assert.equal(track.tags.length, 16);
    assert.equal(track.resolvedStreamUrl, undefined);
    assert.equal(track.cover_url, undefined);
  }
  assert.deepEqual(waveMusicMetadata({ genre: {}, tags: [null, 1, {}, 'Jazz', 'Jazz'] }), {
    tags: ['Jazz'],
  });
  assert.equal(waveQueueContext(context).positiveTracks[0].id, '0');
});

test('Provider radio relevance survives renderer resequencing and never overrides a heard-song exclusion', async () => {
  const candidates = [song('100', undefined), song('101', undefined), song('102', undefined)];
  const discovery = await gatherWaveDiscovery(
    [song('sc_1')],
    {},
    {
      familiarArtists: [],
      related: async () => candidates,
      accept: () => true,
    },
  );
  const direct = discovery.tracks.filter((t) => Number(t.id) >= 100);
  assert.ok(direct[0].waveRadioScore > direct[1].waveRadioScore);
  assert.equal(
    candidates[0].waveRadioScore,
    undefined,
    'provider cache objects must not be mutated',
  );
  const ranked = resequenceWaveQueue([...direct].reverse(), -1, 'discover', [], new Map());
  assert.equal(ranked[0].id, '100');
  assert.ok(
    !sequenceWaveTracks(direct, 'discover', [], 25, {
      recentTracks: [direct[0]],
    }).some((t) => t.id === '100'),
  );
});

test('Mood anchors are selected by classification and still fall back for unknown or uniformly mismatching taste', () => {
  const active = song('sc_1', 'Metal'),
    calm = song('sc_2', 'Ambient'),
    unknown = song('sc_3');
  assert.deepEqual(
    selectWaveMoodSeeds([calm, unknown, active], 'energy').map((t) => t.id),
    ['sc_1'],
  );
  assert.deepEqual(
    selectWaveMoodSeeds([active, unknown, calm], 'chill').map((t) => t.id),
    ['sc_2'],
  );
  assert.equal(selectWaveMoodSeeds([active], 'chill').length, 1);
  assert.equal(selectWaveMoodSeeds([unknown], 'energy').length, 1);
});

for (const mobile of [false])
  for (const mood of ['energy', 'chill']) {
    test(`${'Desktop'} ${mood} uses personal song radios without unrelated curated artists`, async (t) => {
      const seed = song(
        'yt_abcdefghijk',
        mood === 'energy' ? 'Metal' : 'Ambient',
        [],
        `Personal ${mobile} ${mood}`,
      );
      seed.source = 'youtube';
      const queries = [],
        radios = [];
      const search = async (query) => {
        queries.push(query);
        return { data: [] };
      };
      const radio = async (id) => {
        radios.push(id);
        return [song(`radio-${mobile}-${mood}`, seed.genre, [], 'New Compatible Musician')];
      };
      {
        t.mock.method(SoundCloudService, 'search', search);
        t.mock.method(YouTubeMusicService, 'search', search);
        t.mock.method(YouTubeMusicService, 'getRadioTracks', radio);
      }
      const result = await WaveEngine.getWaveBatch(mood, [seed], [], [], [], {}, false);
      assert.ok(radios.includes(seed.id));
      assert.ok(result.some((track) => track.artist.name === 'New Compatible Musician'));
      assert.ok(
        queries.every(
          (query) =>
            query === seed.artist.name ||
            query === seed.artist.name + (mood === 'energy' ? ' energetic' : ' chill'),
        ),
        `unexpected query: ${queries}`,
      );
      assert.ok(result.every((track) => Number.isFinite(track.waveRadioScore)));
    });
  }

test('Explicit song mood overrides broad genre tendencies and a skipped ballad does not equally penalize energetic rock', () => {
  const ballad = song('ballad', 'Rock', ['calm']);
  const energetic = song('active', 'Rock', ['energetic']);
  const anotherBallad = song('another-ballad', 'Rock', ['calm']);
  assert.equal(waveMusicProfile(song('calm-metal', 'Metal', ['calm'])).energy, -1);
  assert.equal(waveMusicProfile(song('active-ambient', 'Ambient', ['energetic'])).energy, 1);
  assert.equal(
    sequenceWaveTracks([anotherBallad, energetic], 'default', [], 2, {
      skippedTracks: [ballad],
    })[0].id,
    energetic.id,
  );
});
