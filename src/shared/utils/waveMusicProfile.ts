import { numericNames, encodeNumbers } from '../compute/songPacket.ts';
import { runRustCompute } from '../compute/rustCore.ts';
import { requireRustCompute, waveMoodId } from '../compute/rustCore.ts';
import type { Track, WaveMood } from '../types/index.ts';

/** Only provider classification metadata is musical evidence; names and titles are not. */
export function waveMusicMetadata(value: {
  genre?: unknown;
  tags?: unknown;
}): Pick<Track, 'genre' | 'tags'> {
  const genre = typeof value.genre === 'string' ? value.genre.trim().slice(0, 100) : '';
  const tags = Array.isArray(value.tags)
    ? [
        ...new Set(
          value.tags
            .slice(0, 16)
            .filter((tag): tag is string => typeof tag === 'string')
            .map((tag) => tag.trim().slice(0, 80))
            .filter(Boolean),
        ),
      ]
    : [];
  return { ...(genre ? { genre } : {}), ...(tags.length ? { tags } : {}) };
}

const STYLE_ALIASES: [string, RegExp][] = [
  ['rock', /(?:^| )(?:rock|рок)(?: |$)/u],
  ['nu metal', /(?:^| )(?:nu metal|numetal|ню метал|нью метал)(?: |$)/u],
  ['grunge', /(?:^| )(?:grunge|гранж)(?: |$)/u],
  ['metalcore', /(?:^| )(?:metalcore|металкор)(?: |$)/u],
  ['alternative rock', /(?:^| )(?:alternative rock|альтернативный рок)(?: |$)/u],
  ['indie rock', /(?:^| )(?:indie rock|инди рок)(?: |$)/u],
  ['shoegaze', /(?:^| )(?:shoegaze|шугейз)(?: |$)/u],
  ['emo', /(?:^| )(?:emo|эмо)(?: |$)/u],
  ['metal', /(?:^| )(?:metal|метал|металл)(?: |$)/u],
  ['punk', /(?:^| )(?:punk|панк)(?: |$)/u],
  ['post punk', /(?:^| )(?:post punk|postpunk|постпанк|пост панк)(?: |$)/u],
  ['hip hop', /(?:^| )(?:hip hop|hiphop|rap|trap|рэп|хип хоп|трэп)(?: |$)/u],
  ['phonk', /(?:^| )(?:phonk|фонк)(?: |$)/u],
  ['electronic', /(?:^| )(?:electronic|electronica|edm|электроника)(?: |$)/u],
  ['house', /(?:^| )(?:house|хаус)(?: |$)/u],
  ['techno', /(?:^| )(?:techno|техно)(?: |$)/u],
  ['drum and bass', /(?:^| )(?:drum and bass|drum bass|dnb|d n b|драм н бейс)(?: |$)/u],
  ['dubstep', /(?:^| )(?:dubstep|дабстеп)(?: |$)/u],
  ['ambient', /(?:^| )(?:ambient|эмбиент|эмбиэнт)(?: |$)/u],
  ['lo fi', /(?:^| )(?:lo fi|lofi|лоуфай)(?: |$)/u],
  ['jazz', /(?:^| )(?:jazz|джаз)(?: |$)/u],
  ['classical', /(?:^| )(?:classical|классика|классическая)(?: |$)/u],
  ['folk', /(?:^| )(?:folk|фолк)(?: |$)/u],
  ['acoustic', /(?:^| )(?:acoustic|акустика|акустический)(?: |$)/u],
  ['pop', /(?:^| )(?:pop|поп)(?: |$)/u],
  ['rnb', /(?:^| )(?:rnb|r b|r and b)(?: |$)/u],
  ['soul', /(?:^| )(?:soul|соул)(?: |$)/u],
  ['reggae', /(?:^| )(?:reggae|регги)(?: |$)/u],
  ['country', /(?:^| )(?:country|кантри)(?: |$)/u],
];
const CALM =
  /(?:^| )(?:chill|chillout|calm|relax|relaxed|relaxing|sleep|sleepy|meditation|спокойная|спокойное|расслабляющая)(?: |$)/u;
const CALM_STYLE = /(?:^| )(?:ambient|lo fi|lofi|downtempo|эмбиент|эмбиэнт)(?: |$)/u;
const ACTIVE =
  /(?:^| )(?:energetic|energy|upbeat|aggressive|workout|dance|бодрая|бодрое|энергичная|энергичное|танцевальная)(?: |$)/u;
const ACTIVE_STYLE =
  /(?:^| )(?:hardstyle|hardcore|metal|punk|phonk|dnb|drum and bass|drum bass|фонк|метал|панк)(?: |$)/u;

export interface WaveMusicProfile {
  styles: ReadonlySet<string>;
  energy: number;
}

export function waveMusicProfile(track: Pick<Track, 'genre' | 'tags'>): WaveMusicProfile {
  const metadata = waveMusicMetadata(track);
  const labels = [metadata.genre || '', ...(metadata.tags || [])]
    .map((label) =>
      label
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim(),
    )
    .filter(Boolean);
  const styles = new Set<string>();
  for (const [style, pattern] of STYLE_ALIASES)
    if (labels.some((label) => pattern.test(label))) styles.add(style);
  const calm = labels.some((label) => CALM.test(label));
  const active = labels.some((label) => ACTIVE.test(label));
  // Explicit mood labels take precedence over broad genre tendencies.
  const energy =
    calm || active
      ? Number(active) - Number(calm)
      : Number(labels.some((label) => ACTIVE_STYLE.test(label))) -
        Number(labels.some((label) => CALM_STYLE.test(label)));
  return { styles, energy };
}

/** Numeric mood scoring is shared with the Rust queue implementation. */
export function waveMoodScore(profile: WaveMusicProfile, mood: WaveMood): number {
  return requireRustCompute().wave_mood_score(profile.energy, waveMoodId(mood));
}

/** Compatibility API: prepare profile data once; the scorer itself exists only in Rust. */
export function createWaveMusicScorer(
  taste: readonly Track[] = [],
  positive: readonly Track[] = [],
  skipped: readonly Track[] = [],
  learned: readonly Track[] = [],
) {
  const pools = [taste, positive, skipped, learned].map((pool) =>
    pool.map((track) => ({ id: String(track.id), profile: waveMusicProfile(track) })),
  );
  return (profile: WaveMusicProfile, mood: WaveMood): number => {
    const styles = numericNames(),
      ids = numericNames();
    const pack = (p: WaveMusicProfile) => [
      p.energy,
      p.styles.size,
      ...[...p.styles].map(styles.id),
    ];
    const words = [waveMoodId(mood), ...pack(profile)];
    for (const pool of pools) {
      words.push(pool.length);
      for (const item of pool) words.push(ids.id(item.id), ...pack(item.profile));
    }
    const result = runRustCompute('music_affinity', encodeNumbers(words));
    if (result.length !== 8) throw Error('Invalid Rust music score');
    return new DataView(result.buffer, result.byteOffset, 8).getFloat64(0, true);
  };
}
