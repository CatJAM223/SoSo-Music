import type { Track, WaveMood } from '../types/index.ts';
const TEMPO_EDIT_TITLE =
  /\b(?:slowed|sped[\s-]*up|speed[\s-]*up|speedup|nightcore|daycore|bass[\s-]*boost(?:ed)?)\b/i;
/** Text attributes only; all penalties and selection rules are owned by Rust. */
export function isWaveTempoEdit(track: Pick<Track, 'title'>): boolean {
  return TEMPO_EDIT_TITLE.test(track.title || '');
}
export function isWaveMoodMismatch(track: Pick<Track, 'title'>, mood: WaveMood): boolean {
  return (
    mood === 'energy' && /\b(?:slowed|daycore|acoustic)\b|акустик|замедлен/i.test(track.title || '')
  );
}
export function waveVersionFlags(track: Pick<Track, 'title'>): number {
  const title = track.title || '';
  return (
    Number(isWaveTempoEdit(track)) |
    (Number(/\b(?:live|acoustic|cover)\b|кавер|акустик/i.test(title)) << 1) |
    (Number(/\b(?:remix|bootleg|mashup)\b/i.test(title)) << 2) |
    (Number(/\bremaster(?:ed)?\b/i.test(title)) << 3)
  );
}
export function isWaveRankingNonSong(track: Pick<Track, 'title'>): boolean {
  return /\b(karaoke|type beat|fan.?made|reaction|podcast)\b|караоке|минусовка/i.test(
    track.title || '',
  );
}
