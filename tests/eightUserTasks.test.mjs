import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { parseInnerTubeShelfItem } from '../src/shared/services/parsers/youtubeMusicParser.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';

// Local storage mock for MobileStorage tests
const hadLocalStorage = 'localStorage' in globalThis;
const origLocalStorage = globalThis.localStorage;

const backingStore = new Map();
globalThis.localStorage = {
  getItem: (key) => (backingStore.has(key) ? backingStore.get(key) : null),
  setItem: (key, value) => backingStore.set(key, String(value)),
  removeItem: (key) => backingStore.delete(key),
  clear: () => backingStore.clear(),
  key: (i) => Array.from(backingStore.keys())[i] ?? null,
  get length() {
    return backingStore.size;
  },
};

after(() => {
  if (!hadLocalStorage) {
    delete globalThis.localStorage;
  } else {
    globalThis.localStorage = origLocalStorage;
  }
});

test('8 User Tasks: YouTube Music InnerTube parser handles both wrapped and unwrapped shelf items', () => {
  const sampleData = {
    flexColumns: [
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: {
            runs: [{ text: 'In The End' }],
          },
        },
      },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: {
            runs: [
              {
                text: 'Linkin Park',
                navigationEndpoint: {
                  browseEndpoint: {
                    browseId: 'UCxgN32UVVztKAQd2HkXzBtw',
                  },
                },
              },
              { text: ' • ' },
              { text: '3:36' },
            ],
          },
        },
      },
    ],
    playlistItemData: {
      videoId: 'eVTXPUF4Oz4',
    },
  };

  const parsed1 = parseInnerTubeShelfItem(sampleData);
  assert.ok(parsed1, 'Unwrapped item should be parsed');
  assert.equal(parsed1.title, 'In The End');
  assert.equal(parsed1.artist.name, 'Linkin Park');
  assert.equal(parsed1.id, 'yt_eVTXPUF4Oz4');
  assert.equal(parsed1.duration, 216);

  const wrapped = {
    musicResponsiveListItemRenderer: sampleData,
  };
  const parsed2 = parseInnerTubeShelfItem(wrapped);
  assert.ok(parsed2, 'Wrapped item should be parsed transparently');
  assert.equal(parsed2.title, 'In The End');
  assert.equal(parsed2.artist.name, 'Linkin Park');
  assert.equal(parsed2.id, 'yt_eVTXPUF4Oz4');
});

test('8 User Tasks: Video IDs with underscores and hyphens are preserved by cleanVideoId', () => {
  const videoIdWithUnderscore = 'a_B-1234_Xy';
  const cleaned = YouTubeMusicService.cleanVideoId(`yt_${videoIdWithUnderscore}`);
  assert.equal(
    cleaned,
    videoIdWithUnderscore,
    'Video ID with underscore and hyphen must not be corrupted',
  );
});

test('Search Suggestions: Preserves artist name on suggestion click and supports artist-only search', async () => {
  const { getSuggestionSearchQuery } = await import('../src/shared/utils/searchHelper.ts');

  // Track suggestion: Title and Artist are distinct -> writes "Artist - Title"
  const trackSuggestion = {
    id: 101,
    title: 'Numb',
    artist: 'Linkin Park',
    type: 'track',
  };
  assert.equal(
    getSuggestionSearchQuery(trackSuggestion),
    'Linkin Park - Numb',
    'Clicking track suggestion must include the artist name so the exact song is found',
  );

  // Clicking specifically on the artist badge -> writes only "Linkin Park"
  assert.equal(
    getSuggestionSearchQuery(trackSuggestion, true),
    'Linkin Park',
    'Clicking artist portion must search for artist only',
  );

  // Artist suggestion -> writes artist name
  const artistSuggestion = {
    id: 202,
    title: 'Linkin Park',
    artist: 'Исполнитель',
    type: 'artist',
  };
  assert.equal(
    getSuggestionSearchQuery(artistSuggestion),
    'Linkin Park',
    'Artist suggestion must write artist name',
  );

  // Title already contains artist -> do not duplicate
  const preformattedTrack = {
    id: 303,
    title: 'Linkin Park - In The End',
    artist: 'Linkin Park',
    type: 'track',
  };
  assert.equal(
    getSuggestionSearchQuery(preformattedTrack),
    'Linkin Park - In The End',
    'Should not duplicate artist if already part of the title',
  );

  // Generic or empty artist -> keep only title
  const genericSuggestion = {
    id: 404,
    title: 'Phonk Gym Mix',
    artist: 'SoundCloud',
    type: 'track',
  };
  assert.equal(
    getSuggestionSearchQuery(genericSuggestion),
    'Phonk Gym Mix',
    'Generic SoundCloud/Поиск artist should not prefix track',
  );
});
