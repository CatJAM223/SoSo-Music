export const WAVE_METHODS = ['radio', 'similar', 'genre', 'artist', 'liked'] as const;
export type WaveMethod = (typeof WAVE_METHODS)[number];
export type WaveNovelty = 'familiar' | 'balanced' | 'fresh';
export const WAVE_FAMILIARITY = ['heard', 'unheard_known_artist', 'unheard_new_artist'] as const;
export type WaveFamiliarity = (typeof WAVE_FAMILIARITY)[number];
export type WaveProvenance = {
  method: WaveMethod;
  provider?: 'youtube' | 'soundcloud' | 'deezer';
  anchor?: string;
};
export type WaveMethodScores = Partial<Record<WaveMethod, number>>;
export type WaveSearchOptions = {
  novelty?: WaveNovelty;
  methodScores?: WaveMethodScores;
  tasteRevision?: number;
};

export function readWaveNovelty(value: unknown): WaveNovelty | undefined {
  return value === 'familiar' || value === 'balanced' || value === 'fresh' ? value : undefined;
}

export function readWaveProvenance(value: unknown): WaveProvenance | undefined {
  if (!value || typeof value !== 'object') return;
  const { method, provider, anchor } = value as WaveProvenance;
  if (!WAVE_METHODS.includes(method)) return;
  return {
    method,
    ...(['youtube', 'soundcloud', 'deezer'].includes(provider || '') ? { provider } : {}),
    ...(typeof anchor === 'string' && anchor.length > 0 && anchor.length <= 128 ? { anchor } : {}),
  };
}

export function readWaveMethodScores(value: unknown): WaveMethodScores | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const scores: WaveMethodScores = {};
  for (const method of WAVE_METHODS) {
    const score = (value as WaveMethodScores)[method];
    if (typeof score === 'number' && Number.isFinite(score) && Math.abs(score) <= 1)
      scores[method] = score;
  }
  return scores;
}

export function mergeWaveProvenance(
  left: readonly WaveProvenance[] = [],
  right: readonly WaveProvenance[] = [],
): WaveProvenance[] {
  const key = (path: WaveProvenance) =>
    WAVE_METHODS.indexOf(path.method) + ':' + (path.provider || '') + ':' + (path.anchor || '');
  const paths = new Map([...left, ...right].map((path) => [key(path), path]));
  return [...paths.keys()]
    .sort()
    .slice(0, 3)
    .map((id) => paths.get(id)!);
}
