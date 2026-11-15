import type { WaveMethodScores } from '../../../shared/types/wavePolicy.ts';

const EXPLORATION_SHARE = 0.15;
const MIN_DIFFERENCE = 0.12;
/** An artist slot costs the same regardless of how that artist was picked. */
export function allocateWaveArtistSearch(
  scores: WaveMethodScores | undefined,
  familiarAvailable: number,
  similarAvailable: number,
  random = Math.random,
): [number, number] {
  const familiar = Math.min(8, familiarAvailable);
  const similar = Math.min(3, similarAvailable);
  const difference = (scores?.artist ?? 0) - (scores?.similar ?? 0);
  if (Math.abs(difference) < MIN_DIFFERENCE || familiar < 4 || similar < 3)
    return [familiar, similar];
  const preferFamiliar = difference > 0;
  const exploring = random() < EXPLORATION_SHARE;
  const favorFamiliar = exploring ? !preferFamiliar : preferFamiliar;
  if (favorFamiliar && familiarAvailable > familiar) return [familiar + 1, similar - 1];
  if (!favorFamiliar && similarAvailable > similar) return [familiar - 1, similar + 1];
  return [familiar, similar];
}
