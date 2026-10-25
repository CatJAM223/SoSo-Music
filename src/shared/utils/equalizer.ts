// The response uses the same RBJ biquads as Web Audio, including shelf slope S=1.
// https://www.w3.org/TR/audio-eq-cookbook/
export const EQUALIZER_FREQUENCIES = [
  32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
] as const;
export const EQUALIZER_LIMIT = 12;
export const EQUALIZER_KEY = 'soso_equalizer';
export const EQUALIZER_Q = Math.SQRT2;
export const EQUALIZER_PRESET_TIME_CONSTANT = 0.07;
export const EQUALIZER_PRESETS = [
  {
    id: 'flat',
    label: 'По умолчанию',
    description: 'Ровное звучание без окрашивания',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'headphones',
    label: 'Наушники',
    description: 'Мягкий бас и ясные детали',
    gains: [2, 2, 1, 0, -1, 0, 1, 2, 1, 0],
  },
  {
    id: 'speakers',
    label: 'Колонки',
    description: 'Плотное звучание и выразительная середина',
    gains: [0, 2, 1, -1, -1, 1, 2, 1, 0, -1],
  },
  {
    id: 'bass',
    label: 'Больше баса',
    description: 'Акцент на низких частотах',
    gains: [4, 5, 3, 1, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'vocal',
    label: 'Вокал',
    description: 'Голос выходит на первый план',
    gains: [-2, -2, -1, 0, 1, 3, 3, 1, 0, -1],
  },
  {
    id: 'rock',
    label: 'Рок',
    description: 'Ударные, гитары и немного яркости',
    gains: [3, 3, 1, -1, -2, 0, 2, 3, 2, 1],
  },
  {
    id: 'soft',
    label: 'Мягкий звук',
    description: 'Спокойный верх для долгого прослушивания',
    gains: [1, 1, 0, 0, 0, 0, -1, -2, -3, -3],
  },
] as const;
export type EqualizerPresetId = (typeof EQUALIZER_PRESETS)[number]['id'] | 'custom';
export type EqualizerSettings = Readonly<{
  enabled: boolean;
  gains: readonly number[];
  presetId: EqualizerPresetId;
}>;
export const clampEqualizerGain = (gain: number): number =>
  Math.round(Math.max(-EQUALIZER_LIMIT, Math.min(EQUALIZER_LIMIT, gain)) * 2) / 2;
export function equalizerPresetId(gains: readonly number[]): EqualizerPresetId {
  return (
    EQUALIZER_PRESETS.find((preset) => preset.gains.every((gain, index) => gain === gains[index]))
      ?.id ?? 'custom'
  );
}
export function readEqualizerSettings(raw: string | null): EqualizerSettings {
  const fallback: EqualizerSettings = {
    enabled: true,
    gains: [...EQUALIZER_PRESETS[0].gains],
    presetId: 'flat',
  };
  try {
    const value: unknown = JSON.parse(raw || 'null');
    if (!value || typeof value !== 'object') return fallback;
    const saved = value as Record<string, unknown>;
    if (
      !Array.isArray(saved.gains) ||
      saved.gains.length !== EQUALIZER_FREQUENCIES.length ||
      !saved.gains.every((gain) => typeof gain === 'number' && Number.isFinite(gain))
    )
      return fallback;
    const gains = saved.gains.map(clampEqualizerGain);
    return {
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : true,
      gains,
      presetId: equalizerPresetId(gains),
    };
  } catch {
    return fallback;
  }
}
export function equalizerFilter(index: number, sampleRate: number) {
  return {
    frequency: Math.min(EQUALIZER_FREQUENCIES[index], sampleRate * 0.49),
    type: (index === 0
      ? 'lowshelf'
      : index === EQUALIZER_FREQUENCIES.length - 1
        ? 'highshelf'
        : 'peaking') as BiquadFilterType,
  };
}
function coefficients(index: number, gain: number, sampleRate: number): number[] {
  const { frequency, type } = equalizerFilter(index, sampleRate);
  const a = 10 ** (gain / 40),
    omega = (2 * Math.PI * frequency) / sampleRate,
    c = Math.cos(omega),
    s = Math.sin(omega);
  if (type === 'peaking') {
    const alpha = s / (2 * EQUALIZER_Q);
    return [1 + alpha * a, -2 * c, 1 - alpha * a, 1 + alpha / a, -2 * c, 1 - alpha / a];
  }
  const beta = Math.sqrt(2 * a) * s;
  return type === 'lowshelf'
    ? [
        a * (a + 1 - (a - 1) * c + beta),
        2 * a * (a - 1 - (a + 1) * c),
        a * (a + 1 - (a - 1) * c - beta),
        a + 1 + (a - 1) * c + beta,
        -2 * (a - 1 + (a + 1) * c),
        a + 1 + (a - 1) * c - beta,
      ]
    : [
        a * (a + 1 + (a - 1) * c + beta),
        -2 * a * (a - 1 + (a + 1) * c),
        a * (a + 1 + (a - 1) * c - beta),
        a + 1 - (a - 1) * c + beta,
        2 * (a - 1 - (a + 1) * c),
        a + 1 - (a - 1) * c - beta,
      ];
}
export type EqualizerResponse = { frequencies: number[]; db: number[]; headroomDb: number };
export function equalizerResponse(gains: readonly number[], sampleRate = 48000): EqualizerResponse {
  const filters = gains.map((gain, index) => coefficients(index, gain, sampleRate));
  const maxFrequency = Math.min(20000, sampleRate * 0.499);
  // Include DC and Nyquist in the headroom estimate, even though the graph shows 20 Hz–20 kHz.
  const frequencies = Array.from({ length: 384 }, (_, i) => 20 * (maxFrequency / 20) ** (i / 383));
  const responseAt = (frequency: number) => {
    const w = (2 * Math.PI * frequency) / sampleRate,
      c1 = Math.cos(w),
      c2 = Math.cos(2 * w),
      s1 = Math.sin(w),
      s2 = Math.sin(2 * w);
    return filters.reduce((db, [b0, b1, b2, a0, a1, a2]) => {
      const numerator = (b0 + b1 * c1 + b2 * c2) ** 2 + (b1 * s1 + b2 * s2) ** 2;
      const denominator = (a0 + a1 * c1 + a2 * c2) ** 2 + (a1 * s1 + a2 * s2) ** 2;
      return db + 10 * Math.log10(Math.max(1e-30, numerator / denominator));
    }, 0);
  };
  const db = frequencies.map(responseAt);
  const peak = Math.max(0, ...db, responseAt(0), responseAt(sampleRate / 2));
  return { frequencies, db, headroomDb: peak > 0.01 ? -(peak + 0.5) : 0 };
}
