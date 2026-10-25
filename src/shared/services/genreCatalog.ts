import type { MusicSource, Track } from '../types/index.ts';
import { scoreImportCandidate } from './playlistImport.ts';
import {
  buildWaveSongIdentity,
  getWaveArtistKeys,
  getWaveArtistNames,
  normalizeWaveArtist,
} from '../utils/waveIdentity.ts';
import { createSongDeduplicator } from '../compute/waveSongMatrix.ts';
import { withWaveTextCache } from '../compute/waveTextCache.ts';
import { isDiscoverySong } from '../utils/discoveryTracks.ts';
import { trackHasGenreTag } from '../utils/genreSearch.ts';

// Exact recordings keep a genre query from matching unrelated titles or DJ mixes.
const SEEDS: Record<string, [string, string][]> = {
  1: [
    ['Kordhell', 'Murder In My Mind'],
    ['INTERWORLD', 'METAMORPHOSIS'],
  ],
  2: [
    ['Kendrick Lamar', 'HUMBLE.'],
    ['Nas', 'N.Y. State of Mind'],
  ],
  3: [
    ['Баста', 'Сансара'],
    ['Oxxxymiron', 'Город под подошвой'],
  ],
  4: [
    ['100 gecs', 'money machine'],
    ['Charli XCX', 'Vroom Vroom'],
  ],
  5: [
    ['Avicii', 'Levels'],
    ['Swedish House Mafia', "Don't You Worry Child"],
  ],
  6: [
    ['Dua Lipa', 'Levitating'],
    ['The Weeknd', 'Blinding Lights'],
  ],
  7: [
    ['Моя Мишель', 'Зима в сердце'],
    ['Zivert', 'Life'],
  ],
  8: [
    ['Nirvana', 'Smells Like Teen Spirit'],
    ['Radiohead', 'Creep'],
  ],
  9: [
    ['Кино', 'Группа крови'],
    ['Король и Шут', 'Кукла колдуна'],
  ],
  10: [
    ['Metallica', 'Master of Puppets'],
    ['Bring Me The Horizon', 'Can You Feel My Heart'],
  ],
  11: [
    ['Nujabes', 'Feather'],
    ['Jinsang', 'affection'],
  ],
  12: [
    ['Disclosure', 'Latch'],
    ['Mr. Fingers', 'Can You Feel It'],
  ],
  13: [
    ['Charlotte de Witte', 'Doppler'],
    ['Adam Beyer', 'Your Mind'],
  ],
  14: [
    ['Kavinsky', 'Nightcall'],
    ['The Midnight', 'Sunset'],
  ],
  15: [
    ['Arctic Monkeys', 'Do I Wanna Know?'],
    ['Joy Division', 'Love Will Tear Us Apart'],
  ],
  16: [
    ['Молчат Дома', 'Судно'],
    ['Дурной Вкус', 'Пластинки'],
  ],
  17: [
    ['SZA', 'Good Days'],
    ['Marvin Gaye', "What's Going On"],
  ],
  18: [
    ['Travis Scott', 'goosebumps'],
    ['Pop Smoke', 'Dior'],
  ],
  19: [
    ['BTS', 'Dynamite'],
    ['BLACKPINK', 'How You Like That'],
  ],
  20: [
    ['Chase & Status', 'Baddadan'],
    ['Sub Focus', 'Timewarp'],
  ],
  21: [
    ['REZZ', 'Edge'],
    ['Gesaffelstein', 'Pursuit'],
  ],
  22: [
    ['Bon Iver', 'Skinny Love'],
    ['Fleet Foxes', 'White Winter Hymnal'],
  ],
  23: [
    ['Skrillex', 'Bangarang'],
    ['Flux Pavilion', "I Can't Stop"],
  ],
  24: [
    ['Miles Davis', 'So What'],
    ['B.B. King', 'The Thrill Is Gone'],
  ],
  25: [
    ['Ludovico Einaudi', 'Nuvole Bianche'],
    ['Ólafur Arnalds', 'Near Light'],
  ],
  26: [
    ['Bob Marley', 'Three Little Birds'],
    ['Steel Pulse', 'Your House'],
  ],
  27: [
    ['Headhunterz', 'Dragonborn'],
    ['Brennan Heart', 'Imaginary'],
  ],
  28: [
    ['Green Day', 'Basket Case'],
    ['blink-182', 'All The Small Things'],
  ],
  29: [
    ['Sidewalks and Skeletons', 'GOTH'],
    ['Pastel Ghost', 'Dark Beach'],
  ],
  30: [
    ['Yung Lean', 'Ginseng Strip 2002'],
    ['Lil Peep', 'Star Shopping'],
  ],
  31: [
    ['Slowdive', 'Alison'],
    ['My Bloody Valentine', 'Only Shallow'],
  ],
  32: [
    ['Haddaway', 'What Is Love'],
    ['Corona', 'The Rhythm of the Night'],
  ],
};

// Editorial artist pools expand each genre beyond two fixed recordings. They
// define the selection scope; a keyword in an arbitrary video title is insufficient.
const ARTISTS: Record<string, string[]> = {
  1: ['DVRST', 'Freddie Dredd', 'Soudiere', 'KSLV Noh'],
  2: ['J. Cole', 'Eminem', 'A Tribe Called Quest', 'Wu-Tang Clan'],
  3: ['Noize MC', 'ATL', 'Скриптонит', 'Хаски'],
  4: ['SOPHIE', 'A. G. Cook', 'Dorian Electra', 'underscores'],
  5: ['deadmau5', 'Martin Garrix', 'Calvin Harris', 'Zedd'],
  6: ['Taylor Swift', 'Billie Eilish', 'Lady Gaga', 'Ariana Grande'],
  7: ['Монеточка', 'Дора', 'IOWA', 'Мари Краймбрери'],
  8: ['Deftones', 'Muse', 'Foo Fighters', 'Linkin Park'],
  9: ['Сплин', 'Би-2', 'Земфира', 'Наутилус Помпилиус'],
  10: ['Slipknot', 'Gojira', 'System Of A Down', 'Architects'],
  11: ['idealism', 'Kupla', 'potsu', 'Joey Pecoraro'],
  12: ['Kerri Chandler', 'Maya Jane Coles', 'Lane 8', 'Ben Böhmer'],
  13: ['Amelie Lens', 'Boris Brejcha', 'Jeff Mills', 'Richie Hawtin'],
  14: ['Carpenter Brut', 'Perturbator', 'FM-84', 'Gunship'],
  15: ['The Strokes', 'Interpol', 'The Cure', 'Franz Ferdinand'],
  16: ['Буерак', 'Перемотка', 'Плохо', 'Утро'],
  17: ['Frank Ocean', 'Daniel Caesar', 'H.E.R.', 'Erykah Badu'],
  18: ['Future', '21 Savage', 'Metro Boomin', 'Chief Keef'],
  19: ['TWICE', 'Stray Kids', 'aespa', 'Red Velvet'],
  20: ['Pendulum', 'Netsky', 'Camo & Krooked', 'High Contrast'],
  21: ['Lorn', '1788-L', 'Deathpact', 'KLOUD'],
  22: ['Sufjan Stevens', 'Daughter', 'The Paper Kites', 'Ben Howard'],
  23: ['Zomboy', 'Excision', 'Virtual Riot', 'Subtronics'],
  24: ['John Coltrane', 'Nina Simone', 'Billie Holiday', 'Stevie Ray Vaughan'],
  25: ['Max Richter', 'Nils Frahm', 'Hania Rani', 'Yiruma'],
  26: ['Peter Tosh', 'Toots & The Maytals', 'Burning Spear', 'Gregory Isaacs'],
  27: ['Wildstylez', 'D-Block & S-te-Fan', 'Da Tweekaz', 'Coone'],
  28: ['The Offspring', 'Sum 41', 'Bad Religion', 'Rancid'],
  29: ['Crystal Castles', 'IC3PEAK', 'White Ring', 'Salem'],
  30: ['Bladee', 'Ecco2k', 'Clams Casino', 'Bones'],
  31: ['Ride', 'Lush', 'Beach House', 'DIIV'],
  32: ['2 Unlimited', 'La Bouche', 'Real McCoy', 'Culture Beat'],
};

export function getGenreArtists(genreId: number | string): string[] {
  return [
    ...new Set([
      ...(SEEDS[String(genreId)] || []).map(([artist]) => artist),
      ...(ARTISTS[String(genreId)] || []),
    ]),
  ];
}

type Providers = {
  soundcloud: (genreId: number | string) => Promise<{ data: Track[] }>;
  youtube: (query: string) => Promise<{ data: Track[] }>;
};

export async function loadGenreCatalog(
  genreId: number | string,
  source: MusicSource,
  providers: Providers,
): Promise<{ data: Track[] }> {
  const seeds = SEEDS[String(genreId)];
  if (!seeds) return { data: [] };
  const artists = getGenreArtists(genreId);
  const sc =
    source === 'youtube'
      ? Promise.resolve({ data: [] as Track[] })
      : providers.soundcloud(genreId).catch(() => ({ data: [] as Track[] }));
  const loadYouTube = async (): Promise<Track[]> => {
    const queries = [
      ...seeds.map(([artist, title]) => ({ artist, title, query: `${artist} - ${title}` })),
      ...artists.map((artist) => ({ artist, title: '', query: artist })),
    ];
    const groups: Track[][] = new Array(queries.length);
    let cursor = 0;
    // Bounded fan-out keeps opening a genre from flooding either provider.
    await Promise.all(
      Array.from({ length: Math.min(3, queries.length) }, async () => {
        while (cursor < queries.length) {
          const index = cursor++;
          const { artist, title, query } = queries[index];
          try {
            const results = await providers.youtube(query);
            groups[index] = results.data
              .filter((track) => {
                if (
                  track.source !== 'youtube' ||
                  !isDiscoverySong(track) ||
                  !getWaveArtistNames(track).some(
                    (name) => normalizeWaveArtist(name) === normalizeWaveArtist(artist),
                  )
                )
                  return false;
                return (
                  !title ||
                  scoreImportCandidate({ id: query, artist, title, duration: 0 }, track).confident
                );
              })
              .slice(0, title ? 1 : 5);
          } catch {
            groups[index] = [];
          }
        }
      }),
    );
    // Round-robin artist pools so one prolific musician cannot dominate the page.
    const result: Track[] = groups.slice(0, seeds.length).flat();
    const artistGroups = groups.slice(seeds.length);
    for (let index = 0; index < 5; index++) {
      for (const group of artistGroups) if (group[index]) result.push(group[index]);
    }
    return result;
  };
  const yt = source === 'soundcloud' ? Promise.resolve([] as Track[]) : loadYouTube();
  const [soundcloud, youtube] = await Promise.all([sc, yt]);
  return withWaveTextCache(() => {
    const result: Track[] = [];
    const seen = new Set<string>();
    const artistCounts = new Map<string, number>();
    const candidates: Track[] = [];
    // Preserve provider interleaving before preparing one bounded Rust comparison batch.
    for (let i = 0; i < Math.max(soundcloud.data.length, youtube.length); i++) {
      for (const track of [youtube[i], soundcloud.data[i]]) {
        if (!track || !isDiscoverySong(track)) continue;
        if (track.source === 'soundcloud' && !trackHasGenreTag(track, genreId)) continue;
        candidates.push(track);
      }
    }
    const songs = createSongDeduplicator(candidates, (track) =>
      buildWaveSongIdentity(track, artists),
    );
    for (let index = 0; index < candidates.length; index++) {
      const track = candidates[index];
      const key = `${track.source}:${track.id}`;
      if (seen.has(key) || songs.hasDuplicate(index)) continue;
      const keys = getWaveArtistKeys(track, artists);
      if (keys.some((artist) => (artistCounts.get(artist) || 0) >= 6)) continue;
      seen.add(key);
      songs.accept(index);
      keys.forEach((artist) => artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1));
      result.push(track);
    }
    return { data: result };
  });
}
