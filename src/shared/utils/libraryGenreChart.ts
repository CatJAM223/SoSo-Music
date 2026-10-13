import type { LibraryTasteGenre } from '../types/libraryTaste.ts';

const COLORS = [
  '#e8bd34',
  '#74abed',
  '#b899e8',
  '#61ccc6',
  '#e99865',
  '#e07e8b',
  '#b4ca62',
  '#69c59c',
  '#92a6be',
  '#d696d1',
  '#a7c9ef',
  '#dfc58d',
];

export function libraryGenreSegments(genres: readonly LibraryTasteGenre[]) {
  const positive = genres.filter((genre) => Number.isFinite(genre.share) && genre.share > 0);
  const total = positive.reduce((sum, genre) => sum + genre.share, 0);
  if (!total) return [];
  const segments = positive.map((genre, index) => ({
    ...genre,
    fraction: genre.share / total,
    percentage: Math.floor((genre.share / total) * 100),
    color: COLORS[index % COLORS.length],
  }));
  const remainderOrder = segments
    .map((segment, index) => ({ index, remainder: segment.fraction * 100 - segment.percentage }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  const remainder = 100 - segments.reduce((sum, segment) => sum + segment.percentage, 0);
  for (const { index } of remainderOrder.slice(0, remainder)) segments[index].percentage++;
  let offset = 0;
  return segments.map((segment) => {
    const start = offset;
    offset += segment.fraction;
    return { ...segment, start, end: offset };
  });
}

function point(turn: number, radius: number): string {
  const angle = turn * Math.PI * 2 - Math.PI / 2;
  return (
    (160 + Math.cos(angle) * radius).toFixed(3) + ' ' + (160 + Math.sin(angle) * radius).toFixed(3)
  );
}

export function libraryGenreArc(start: number, end: number): string {
  if (end - start >= 0.999999)
    return 'M 160 22 A 138 138 0 1 1 160 298 A 138 138 0 1 1 160 22 Z M 160 70 A 90 90 0 1 0 160 250 A 90 90 0 1 0 160 70 Z';
  const large = end - start > 0.5 ? 1 : 0;
  return (
    'M ' +
    point(start, 138) +
    ' A 138 138 0 ' +
    large +
    ' 1 ' +
    point(end, 138) +
    ' L ' +
    point(end, 90) +
    ' A 90 90 0 ' +
    large +
    ' 0 ' +
    point(start, 90) +
    ' Z'
  );
}

export function libraryGenreLabelPosition(start: number, end: number) {
  const angle = ((start + end) / 2) * Math.PI * 2 - Math.PI / 2;
  return { x: 160 + Math.cos(angle) * 114, y: 160 + Math.sin(angle) * 114 };
}

export function genreTrackCount(count: number): string {
  const form = new Intl.PluralRules('ru').select(count);
  const label = form === 'one' ? 'трек' : form === 'few' ? 'трека' : 'треков';
  return new Intl.NumberFormat('ru-RU').format(count) + ' ' + label;
}
