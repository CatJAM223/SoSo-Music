// Deterministic offline provider-shaped input; no account or network access.
export const moods = ['default', 'energy', 'chill', 'discover', 'mix', 'favorites'];
const genres = [
  'alternative rock',
  'phonk',
  'ambient',
  'hip hop',
  'jazz',
  'indie rock',
  'drum and bass',
  'lo fi',
  'pop',
  'nu metal',
  'classical',
  'electronic',
];
const names = ['Nirvana', 'Молчат Дома', 'ThxSoMch', 'Øneheart', '夜の音', 'Björk'];
const nonce = (i) => (Math.imul(i + 17, 2654435761) >>> 0).toString(36).padStart(7, 'x');
export function rankingTracks(count, start = 0, seed = 0) {
  return Array.from({ length: count }, (_, k) => {
    const i = k + start + seed * 10000;
    const artist = names[i % names.length] + ' Artist ' + (i % 47);
    return {
      id: 'ranking-' + i,
      title: 'Distant ' + nonce(i) + ' ' + nonce(i + 113) + (i % 13 === 0 ? ' (Live)' : ''),
      artist: { name: artist + (i % 17 === 0 ? ' feat. Guest ' + (i % 7) : '') },
      source: i % 2 ? 'youtube' : 'soundcloud',
      album: { title: i % 3 ? 'Single' : 'Album' },
      duration: 110 + (i % 300),
      genre: genres[i % genres.length],
      tags: i % 4 === 0 ? ['chill'] : i % 4 === 1 ? ['energetic'] : [],
      waveRadioScore: (i % 101) / 100,
      waveGenreScore: (i % 11) / 10,
      ...(i % 19 === 0 ? { waveSeedWeight: 2 } : {}),
    };
  });
}
export function rankingCase(count, history = 40, limit = 25, seed = 0) {
  const tracks = rankingTracks(count, 0, seed);
  const familiar = [...new Set(tracks.slice(0, 25).map((t) => t.artist.name))];
  return {
    count,
    history,
    limit,
    tracks,
    familiar,
    options: {
      recentTracks: rankingTracks(history, 5000, seed),
      offeredTracks: rankingTracks(Math.min(history, 80), 7000, seed),
      tasteTracks: tracks.filter((t) => t.waveSeedWeight === 2).slice(0, 12),
      positiveTracks: rankingTracks(4, 8000, seed),
      skippedTracks: rankingTracks(3, 9000, seed),
      learnedTracks: rankingTracks(6, 10000, seed),
      recentArtists: familiar.slice(0, 12),
      artistFeedback: new Map(familiar.map((a, i) => [a.toLowerCase(), i % 3 ? 0.75 : -0.8])),
      sequenceOffset: seed % 21,
      discoveryAdjustment: ((seed % 5) - 2) / 10,
    },
  };
}
