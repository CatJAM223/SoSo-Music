export type ThemePreset =
  'default' | 'sakura' | 'weather' | 'blackhole' | 'wallpaper' | 'nighttrain' | 'cassette';
export type SceneIntensity = 'quiet' | 'full' | 'still';
export type ThemeMode = 'dark' | 'light';
export type WeatherMode = 'clear' | 'rain';
export type AccentColor =
  'emerald' | 'cyan' | 'blue' | 'purple' | 'orange' | 'rose' | 'red' | 'amber';

export interface AccentColorOption {
  id: AccentColor;
  name: string;
  color: string;
  rgb: string;
  borderClass: string;
  bgClass: string;
}

export const ACCENT_COLOR_OPTIONS: AccentColorOption[] = [
  {
    id: 'emerald',
    name: 'Зелёный',
    color: '#22c55e',
    rgb: '34, 197, 94',
    borderClass: 'border-emerald-500',
    bgClass: 'bg-emerald-500',
  },
  {
    id: 'cyan',
    name: 'Голубой',
    color: '#06b6d4',
    rgb: '6, 182, 212',
    borderClass: 'border-cyan-500',
    bgClass: 'bg-cyan-500',
  },
  {
    id: 'blue',
    name: 'Синий',
    color: '#2563eb',
    rgb: '37, 99, 235',
    borderClass: 'border-blue-600',
    bgClass: 'bg-blue-600',
  },
  {
    id: 'purple',
    name: 'Фиолетовый',
    color: '#8b5cf6',
    rgb: '139, 92, 246',
    borderClass: 'border-purple-500',
    bgClass: 'bg-purple-500',
  },
  {
    id: 'orange',
    name: 'Оранжевый',
    color: '#f97316',
    rgb: '249, 115, 22',
    borderClass: 'border-orange-500',
    bgClass: 'bg-orange-500',
  },
  {
    id: 'rose',
    name: 'Розовый',
    color: '#ec4899',
    rgb: '236, 72, 153',
    borderClass: 'border-pink-500',
    bgClass: 'bg-pink-500',
  },
  {
    id: 'red',
    name: 'Красный',
    color: '#ef4444',
    rgb: '239, 68, 68',
    borderClass: 'border-red-500',
    bgClass: 'bg-red-500',
  },
  {
    id: 'amber',
    name: 'Жёлтый',
    color: '#eab308',
    rgb: '234, 179, 8',
    borderClass: 'border-amber-500',
    bgClass: 'bg-amber-500',
  },
];

export interface ThemeOption {
  id: ThemePreset;
  name: string;
  description: string;
  accentColor: string;
  previewGradient: string;
  bgPreview: string;
  badge?: string;
  desktopOnly?: boolean;
}

export const EASTER_EGG_THEME_OPTION: ThemeOption = {
  id: 'blackhole',
  name: 'Чёрная дыра',
  description: 'Тьма космоса с пульсирующим горизонтом событий и огненным аккреционным диском',
  accentColor: '#fb923c',
  previewGradient: 'from-orange-500 via-purple-700 to-black',
  bgPreview: '#050308',
  badge: '🕳️ Event Horizon',
};

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'nighttrain',
    name: 'Ночной город',
    description: 'Процедурные огни ночного города и дождь с голубыми акцентами',
    accentColor: '#7dd3fc',
    previewGradient: 'from-sky-300 via-indigo-700 to-slate-950',
    bgPreview: '#080f1b',
    badge: 'Огни города',
  },
  {
    id: 'cassette',
    name: 'Аналоговая лента',
    description: 'Плавные светящиеся ленты и тёплая янтарная палитра',
    accentColor: '#fbbf77',
    previewGradient: 'from-amber-200 via-orange-700 to-stone-950',
    bgPreview: '#16110e',
    badge: 'Аналоговый звук',
  },
  {
    id: 'default',
    name: 'Стандартная',
    description: 'Классический интерфейс с выбором светлой/темной темы и цвета',
    accentColor: '#22c55e',
    previewGradient: 'from-emerald-500 via-teal-500 to-green-600',
    bgPreview: '#121212',
    badge: 'Светлая / Тёмная',
  },
  {
    id: 'sakura',
    name: 'Цветение Сакуры',
    description: 'Нежный бело-розовый фон с шелковыми падающими лепестками',
    accentColor: '#f43f5e',
    previewGradient: 'from-pink-300 via-rose-300 to-rose-400',
    bgPreview: '#fdf4f6',
    badge: '🌸 Live Petals',
  },
  {
    id: 'weather',
    name: 'Погода',
    description:
      'Динамическая погода: ясный день с парящими листьями или пасмурный дождливый шторм',
    accentColor: '#10b981',
    previewGradient: 'from-emerald-400 via-teal-500 to-sky-600',
    bgPreview: '#0e1713',
    badge: '🍃 Live Weather',
  },
  {
    id: 'wallpaper',
    name: 'Видеообои',
    description:
      'Локальное видео или GIF фоном приложения: зацикленный muted-плеер с настройкой яркости и размытия',
    accentColor: '#22c55e',
    previewGradient: 'from-indigo-500 via-fuchsia-500 to-amber-400',
    bgPreview: '#0a0a12',
    badge: '🎬 Live Video',
  },
];

export function getEffectiveThemeMode(
  themePreset: ThemePreset,
  themeMode: ThemeMode = 'dark',
  weatherMode: WeatherMode = 'clear',
): ThemeMode {
  if (themePreset === 'default') return themeMode;
  if (themePreset === 'sakura') return 'light';
  if (themePreset === 'weather') return weatherMode === 'clear' ? 'light' : 'dark';
  return 'dark';
}

export function getWeatherThemePalette(weatherMode: WeatherMode): {
  accent: string;
  accentRgb: string;
  bgLight: string;
  bgDark: string;
} {
  if (weatherMode === 'rain') {
    return {
      accent: '#38bdf8',
      accentRgb: '56, 189, 248',
      bgLight: '#090e14',
      bgDark: '#090e14',
    };
  }
  return {
    accent: '#10b981',
    accentRgb: '16, 185, 129',
    bgLight: '#f5f9f6',
    bgDark: '#0e1713',
  };
}

export interface AdaptiveThemeResult {
  preset: ThemePreset;
  weatherMode?: WeatherMode;
}

export function resolveAdaptiveTheme(
  track:
    | {
        title?: string;
        artist?: string;
        genre?: string;
      }
    | null
    | undefined,
): AdaptiveThemeResult | null {
  if (!track) return null;

  const title = (track.title || '').toLowerCase();
  const artist = (track.artist || '').toLowerCase();
  const genre = (track.genre || '').toLowerCase();
  const combined = `${title} ${artist} ${genre}`;

  // 1. Heavy / Metal / Phonk / Dark / Cyberpunk / Hardcore -> blackhole
  const darkHeavyRegex =
    /\b(metal|heavy metal|death metal|black metal|phonk|hardcore|punk|rock|dark techno|cyberpunk|doom|sludge|industrial|trap metal)\b/i;
  // 2. J-Pop / K-Pop / Anime / Vocaloid / Kawaii / Nightcore / Sakura / Japan -> sakura
  const animeJapaneseRegex =
    /\b(j-pop|jpop|k-pop|kpop|anime|vocaloid|kawaii|nightcore|sakura|japanese|touhou|miku|genshin)\b/i;
  // 3. Lo-Fi / Acoustic / Chill / Jazz / Ambient / Rain / Sleep / Piano -> weather
  const chillWeatherRegex =
    /\b(lo-fi|lofi|acoustic|chill|jazz|ambient|rain|sleep|peaceful|piano|calm|nature|rainy|storm)\b/i;

  if (darkHeavyRegex.test(combined)) {
    return { preset: 'blackhole' };
  }
  if (animeJapaneseRegex.test(combined)) {
    return { preset: 'sakura' };
  }
  if (chillWeatherRegex.test(combined)) {
    const isRain = /\b(rain|storm|thunder|rainy|night|dark)\b/i.test(combined);
    return { preset: 'weather', weatherMode: isRain ? 'rain' : 'clear' };
  }

  return { preset: 'default' };
}
