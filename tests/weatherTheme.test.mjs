import test from 'node:test';
import assert from 'node:assert';
import {
  THEME_OPTIONS,
  ACCENT_COLOR_OPTIONS,
  EASTER_EGG_THEME_OPTION,
  getWeatherThemePalette,
  getEffectiveThemeMode,
  resolveAdaptiveTheme,
} from '../src/shared/context/themeData.ts';

test('Theme System: Weather Preset is registered with clear and rain modes', () => {
  const weatherOption = THEME_OPTIONS.find((t) => t.id === 'weather');
  assert.ok(weatherOption, 'Weather option should exist in THEME_OPTIONS');
  assert.strictEqual(weatherOption.name, 'Погода');
  assert.strictEqual(weatherOption.accentColor, '#10b981');
  assert.ok(weatherOption.badge.includes('Weather'), 'Badge should indicate live weather');
});

test('Theme System: Active UI presets include both listening scenes on desktop and mobile', () => {
  const ids = THEME_OPTIONS.map((t) => t.id);
  assert.deepStrictEqual(ids, [
    'nighttrain',
    'cassette',
    'default',
    'sakura',
    'weather',
    'wallpaper',
  ]);
  for (const id of ['nighttrain', 'cassette']) {
    assert.notStrictEqual(THEME_OPTIONS.find((t) => t.id === id).desktopOnly, true);
    assert.strictEqual(getEffectiveThemeMode(id, 'light'), 'dark');
  }
  assert.strictEqual(ACCENT_COLOR_OPTIONS.length, 8);
});

test('Theme System: Video Wallpaper preset is available on desktop and mobile', () => {
  const wallpaperOption = THEME_OPTIONS.find((t) => t.id === 'wallpaper');
  assert.ok(wallpaperOption, 'Wallpaper option should exist in THEME_OPTIONS');
  assert.strictEqual(wallpaperOption.name, 'Видеообои');
  assert.notStrictEqual(
    wallpaperOption.desktopOnly,
    true,
    'Wallpaper preset must be available on mobile',
  );
});

test('Theme System: Black Hole preset is registered as a secret easter egg theme', () => {
  assert.strictEqual(EASTER_EGG_THEME_OPTION.id, 'blackhole');
  assert.strictEqual(EASTER_EGG_THEME_OPTION.name, 'Чёрная дыра');
  assert.strictEqual(EASTER_EGG_THEME_OPTION.accentColor, '#fb923c');
  assert.strictEqual(EASTER_EGG_THEME_OPTION.bgPreview, '#050308');
  assert.ok(
    EASTER_EGG_THEME_OPTION.badge?.includes('Event Horizon'),
    'Badge should indicate the event horizon',
  );
});

test('Theme System: Weather clear mode uses emerald palette and rain mode uses storm cyan', () => {
  const clearPalette = getWeatherThemePalette('clear');
  assert.strictEqual(clearPalette.accent, '#10b981');
  assert.strictEqual(clearPalette.accentRgb, '16, 185, 129');
  assert.strictEqual(clearPalette.bgLight, '#f5f9f6');

  const rainPalette = getWeatherThemePalette('rain');
  assert.strictEqual(rainPalette.accent, '#38bdf8');
  assert.strictEqual(rainPalette.accentRgb, '56, 189, 248');
  assert.strictEqual(rainPalette.bgDark, '#090e14');

  // Effective mode resolution
  assert.strictEqual(getEffectiveThemeMode('weather', 'dark', 'clear'), 'light');
  assert.strictEqual(getEffectiveThemeMode('weather', 'light', 'rain'), 'dark');
  assert.strictEqual(getEffectiveThemeMode('sakura'), 'light');
  assert.strictEqual(getEffectiveThemeMode('blackhole'), 'dark');
});

test('Theme System: Adaptive theme resolution maps tracks to aesthetic presets', () => {
  assert.strictEqual(resolveAdaptiveTheme(null), null);
  assert.strictEqual(resolveAdaptiveTheme(undefined), null);

  // Metal / Phonk -> blackhole
  const heavy = resolveAdaptiveTheme({
    title: 'Murder In My Mind',
    artist: 'Kordhell',
    genre: 'phonk',
  });
  assert.deepStrictEqual(heavy, { preset: 'blackhole' });

  const metal = resolveAdaptiveTheme({
    title: 'Master of Puppets',
    artist: 'Metallica',
    genre: 'Heavy Metal',
  });
  assert.deepStrictEqual(metal, { preset: 'blackhole' });

  // Anime / J-Pop -> sakura
  const anime = resolveAdaptiveTheme({ title: 'Sparkle', artist: 'RADWIMPS', genre: 'Anime OST' });
  assert.deepStrictEqual(anime, { preset: 'sakura' });

  // Chill / Lo-Fi -> weather clear
  const lofi = resolveAdaptiveTheme({
    title: 'Afternoon Coffee',
    artist: 'Chillhop Music',
    genre: 'Lo-Fi',
  });
  assert.deepStrictEqual(lofi, { preset: 'weather', weatherMode: 'clear' });

  // Rainy / Storm -> weather rain
  const rainy = resolveAdaptiveTheme({
    title: 'Rainy Night In Tokyo',
    artist: 'Lofi Sleep',
    genre: 'Ambient',
  });
  assert.deepStrictEqual(rainy, { preset: 'weather', weatherMode: 'rain' });

  // Standard pop / unknown -> default
  const pop = resolveAdaptiveTheme({
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    genre: 'Pop',
  });
  assert.deepStrictEqual(pop, { preset: 'default' });
});
