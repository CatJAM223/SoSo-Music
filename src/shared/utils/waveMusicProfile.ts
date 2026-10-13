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

function similarity(left: WaveMusicProfile, right: WaveMusicProfile): number {
  if (!left.styles.size || !right.styles.size) return 0;
  let shared = 0;
  for (const style of left.styles) if (right.styles.has(style)) shared++;
  const moodCompatibility = left.energy * right.energy < 0 ? 0.2 : 1;
  return (shared / Math.sqrt(left.styles.size * right.styles.size)) * moodCompatibility;
}

export function waveMoodScore(profile: WaveMusicProfile, mood: WaveMood): number {
  // The selected mood must outweigh ordinary familiarity and genre-affinity bonuses.
  return mood === 'energy' ? profile.energy * 12 : mood === 'chill' ? -profile.energy * 12 : 0;
}

/** Keep multiple taste clusters. A skip is a temporary hint, never a genre ban. */
export function createWaveMusicScorer(
  taste: readonly Track[] = [],
  positives: readonly Track[] = [],
  skipped: readonly Track[] = [],
  learned: readonly Track[] = [],
) {
  const profiles = (tracks: readonly Track[], limit: number) => {
    const seen = new Set<string>();
    const selected: WaveMusicProfile[] = [];
    for (const track of tracks) {
      if (seen.has(String(track.id))) continue;
      seen.add(String(track.id));
      selected.push(waveMusicProfile(track));
      if (selected.length >= limit) break;
    }
    return selected;
  };
  const tasteProfiles = profiles(taste, 48),
    positiveProfiles = profiles(positives, 12),
    skippedProfiles = profiles(skipped, 12),
    learnedProfiles = profiles(learned, 48);
  const affinity = (profile: WaveMusicProfile, pool: WaveMusicProfile[], decay = 1) =>
    Math.max(0, ...pool.map((anchor, index) => similarity(profile, anchor) * decay ** index));
  return (profile: WaveMusicProfile, mood: WaveMood) => {
    const negativeEvidence = skippedProfiles.reduce(
      (sum, anchor, index) => sum + similarity(profile, anchor) * 0.75 ** index,
      0,
    );
    // Corroborated skips can outweigh an old success; one skip leaves that anchor intact.
    const positive =
      affinity(profile, positiveProfiles, 0.85) *
      Math.max(0, 1 - Math.max(0, negativeEvidence - 1.5) / 0.75);
    const negative = Math.min(1, negativeEvidence / 2);
    let score =
      waveMoodScore(profile, mood) +
      affinity(profile, tasteProfiles) * 2 +
      affinity(profile, learnedProfiles) * 1.5 +
      positive * 4;
    // Successful listening in the same style counterbalances an isolated skip.
    score -= Math.max(0, negative - positive) * 4;
    return score;
  };
}

/** Transition cost depends on the preceding selection; taste relevance does not. */
export function waveTransitionScore(
  profile: WaveMusicProfile,
  previous: WaveMusicProfile | undefined,
  mood: WaveMood,
): number {
  if (!previous) return 0;
  // A mix deliberately moves between taste clusters instead of following one style.
  if (mood === 'mix') return -similarity(profile, previous) * 3;
  const coherence =
    similarity(profile, previous) * 1.5 - (profile.energy * previous.energy < 0 ? 1 : 0);
  return coherence;
}
