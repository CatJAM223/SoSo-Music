import type { Track } from '../types/index.ts';

interface GenreSearchConfig {
  soundCloudSlug?: string;
  /** Published Music Charts playlist; its scope may be broader than this genre. */
  soundCloudChart?: string;
  queries: string[];
  tags: string[];
}

const GENRE_SEARCH: Record<string, GenreSearchConfig> = {
  '1': { queries: ['phonk', 'drift phonk'], tags: ['phonk', 'drift phonk', 'cowbell'] },
  '2': {
    soundCloudSlug: 'hiphoprap',
    soundCloudChart: 'hip-hop',
    queries: ['hip hop', 'rap'],
    tags: ['hip hop', 'hip-hop', 'rap'],
  },
  '3': {
    queries: ['русский рэп', 'russian rap'],
    tags: ['русский рэп', 'russian rap', 'russian hip hop', 'рэп на русском'],
  },
  '4': { queries: ['hyperpop', 'glitchcore'], tags: ['hyperpop', 'glitchcore', 'glitch core'] },
  '5': {
    soundCloudSlug: 'danceedm',
    soundCloudChart: 'electronic',
    queries: ['edm', 'dance'],
    tags: ['edm', 'dance', 'electronic dance'],
  },
  '6': {
    soundCloudSlug: 'pop',
    soundCloudChart: 'pop',
    queries: ['pop music'],
    tags: ['pop', 'pop music'],
  },
  '7': {
    queries: ['русская поп музыка', 'russian pop'],
    tags: ['русская поп', 'russian pop', 'русская поп-музыка'],
  },
  '8': {
    soundCloudSlug: 'alternativerock',
    soundCloudChart: 'rock',
    queries: ['alternative rock'],
    tags: ['alternative rock', 'alt rock', 'alternative rock music'],
  },
  '9': {
    queries: ['русский рок', 'russian rock'],
    tags: ['русский рок', 'russian rock', 'русский альтернативный рок'],
  },
  '10': {
    soundCloudSlug: 'metal',
    soundCloudChart: 'rock',
    queries: ['metal', 'metalcore'],
    tags: ['metal', 'metalcore', 'heavy metal'],
  },
  '11': { queries: ['lofi', 'lo fi beats'], tags: ['lofi', 'lo-fi', 'lo fi', 'chillhop'] },
  '12': {
    soundCloudSlug: 'deephouse',
    soundCloudChart: 'electronic',
    queries: ['deep house'],
    tags: ['deep house', 'deephouse'],
  },
  '13': {
    soundCloudSlug: 'techno',
    soundCloudChart: 'electronic',
    queries: ['techno'],
    tags: ['techno'],
  },
  '14': { queries: ['synthwave', 'retrowave'], tags: ['synthwave', 'retrowave', 'synth wave'] },
  '15': {
    soundCloudSlug: 'indie',
    soundCloudChart: 'rock',
    queries: ['indie rock', 'post punk'],
    tags: ['indie rock', 'post punk', 'post-punk', 'инди рок'],
  },
  '16': {
    queries: ['russian doomer', 'русский пост панк'],
    tags: ['russian doomer', 'doomer', 'русский пост панк', 'пост-панк'],
  },
  '17': {
    soundCloudSlug: 'rbsoul',
    soundCloudChart: 'r-b',
    queries: ['r&b', 'soul'],
    tags: ['r&b', 'rnb', 'soul', 'rhythm and blues'],
  },
  '18': {
    soundCloudSlug: 'trap',
    soundCloudChart: 'hip-hop',
    queries: ['trap', 'drill rap'],
    tags: ['trap', 'drill'],
  },
  '19': { queries: ['kpop', 'k-pop'], tags: ['kpop', 'k-pop', 'korean pop'] },
  '20': {
    soundCloudSlug: 'drumbass',
    soundCloudChart: 'electronic',
    queries: ['drum and bass', 'jungle'],
    tags: ['drum and bass', 'drum & bass', 'dnb', 'jungle'],
  },
  '21': { queries: ['cyberpunk music', 'midtempo'], tags: ['cyberpunk', 'midtempo'] },
  '22': {
    soundCloudSlug: 'folksingersongwriter',
    soundCloudChart: 'folk',
    queries: ['indie folk', 'acoustic folk'],
    tags: ['indie folk', 'folk', 'acoustic'],
  },
  '23': {
    soundCloudSlug: 'dubstep',
    soundCloudChart: 'electronic',
    queries: ['dubstep'],
    tags: ['dubstep'],
  },
  '24': { soundCloudSlug: 'jazzblues', queries: ['jazz', 'blues'], tags: ['jazz', 'blues'] },
  '25': {
    soundCloudSlug: 'classical',
    queries: ['neoclassical piano', 'modern classical'],
    tags: ['neoclassical', 'neo classical', 'classical piano'],
  },
  '26': { soundCloudSlug: 'reggae', queries: ['reggae', 'dub roots'], tags: ['reggae', 'dub'] },
  '27': { queries: ['hardstyle', 'rawstyle'], tags: ['hardstyle', 'rawstyle'] },
  '28': { queries: ['punk rock', 'pop punk'], tags: ['punk rock', 'pop punk', 'punk'] },
  '29': { queries: ['witch house', 'darkwave'], tags: ['witch house', 'darkwave'] },
  '30': { queries: ['cloud rap', 'sad trap'], tags: ['cloud rap', 'emo rap', 'sad rap'] },
  '31': { queries: ['shoegaze', 'dream pop'], tags: ['shoegaze', 'dream pop'] },
  '32': { queries: ['eurodance', '90s dance'], tags: ['eurodance', '90s dance'] },
};

export function getGenreSearchConfig(id: number | string): GenreSearchConfig | undefined {
  return GENRE_SEARCH[String(id)];
}

function normalizeTag(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Only match explicit SoundCloud genre/tag metadata, never a title or artist name. */
export function trackHasGenreTag(track: Track, genreId: number | string): boolean {
  const config = getGenreSearchConfig(genreId);
  if (!config) return false;

  const metadata = [track.genre || '', ...(track.tags || [])].map(normalizeTag).filter(Boolean);
  return config.tags.some((tag) => {
    const normalized = normalizeTag(tag);
    return metadata.some(
      (value) => value === normalized || ` ${value} `.includes(` ${normalized} `),
    );
  });
}

export function parseSoundCloudTags(tagList: unknown): string[] {
  if (typeof tagList !== 'string' || !tagList.trim()) return [];
  const tags: string[] = [];
  const pattern = /"([^"]+)"|'([^']+)'|(\S+)/g;
  for (const match of tagList.matchAll(pattern)) {
    const tag = (match[1] || match[2] || match[3] || '').trim();
    if (tag) tags.push(tag);
  }
  return tags;
}
