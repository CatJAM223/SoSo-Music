export function searchTracks(count, seed = 1) {
  const titles = [
    'Paranoid Android',
    'Love',
    'Love (cover)',
    'Nightcore Love',
    '1 hour loop',
    'Track ft. A feat. B featuring C',
    'mashup song',
    'karaoke минус',
    'Official Remix',
    'prod. by artist',
    'slowed + reverb',
    'Привет мир',
    'Любовь\u0301',
    '𐐀 Song',
    'Podcast reaction',
    'Cover version',
    'Same -- song',
    'Same song',
    'Fan-made tribute',
    'Mix',
  ];
  const artists = ['Radiohead', 'Artist', 'DJ Channel', 'Гражданская Оборона', '歌手', 'A & B'];
  let value = seed;
  const random = (n) => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value % n;
  };
  return Array.from({ length: count }, (_, i) => ({
    id: 'track:' + i,
    title: titles[random(titles.length)] + (i % 4 ? '' : ' ' + random(40)),
    artist: { name: artists[random(artists.length)] },
    album: { title: ['Single', 'Unknown Album', 'Record', ''][random(4)] },
    source: ['youtube', 'soundcloud', undefined][random(3)],
    duration: [0, 15, 34, 35, 150, 360, 900, 901, 1000][random(9)],
    user: { verified: Boolean(random(2)) },
  }));
}
export const searchQueries = [
  'radiohead - paranoid android',
  'Radiohead Paranoid Android',
  'love',
  'love cover',
  'nightcore',
  'mix',
  'podcast reaction',
  'prod. by',
  'slowed reverb',
  'karaoke минус',
  'Привет мир',
  'Song: Artist',
  'A - B',
  '歌手',
  '𐐀 Song',
  '',
  '  ',
  '-',
  ':',
  'Artist—Track',
];
