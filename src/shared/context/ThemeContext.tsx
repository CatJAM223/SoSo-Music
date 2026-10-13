import React, { createContext, useContext, useEffect, useState } from 'react';

import {
  ThemePreset,
  SceneIntensity,
  ThemeMode,
  WeatherMode,
  AccentColor,
  AccentColorOption,
  ACCENT_COLOR_OPTIONS,
  ThemeOption,
  THEME_OPTIONS,
  EASTER_EGG_THEME_OPTION,
  AdaptiveThemeResult,
  resolveAdaptiveTheme,
} from './themeData';

export type {
  ThemePreset,
  SceneIntensity,
  ThemeMode,
  WeatherMode,
  AccentColor,
  AccentColorOption,
  ThemeOption,
  AdaptiveThemeResult,
};
export { ACCENT_COLOR_OPTIONS, THEME_OPTIONS, EASTER_EGG_THEME_OPTION, resolveAdaptiveTheme };

interface ThemeContextType {
  sceneIntensity: SceneIntensity;
  setSceneIntensity: (value: SceneIntensity) => void;
  themePreset: ThemePreset;
  themeMode: ThemeMode;
  weatherMode: WeatherMode;
  accentColor: AccentColor;
  cursorGlow: boolean;
  wallpaperPath: string | null;
  wallpaperDim: number;
  wallpaperBlur: number;
  isAdaptiveThemeEnabled: boolean;
  setThemePreset: (preset: ThemePreset) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setWeatherMode: (mode: WeatherMode) => void;
  toggleWeatherMode: () => void;
  setAccentColor: (accent: AccentColor) => void;
  toggleThemeMode: () => void;
  setCursorGlow: (enabled: boolean) => void;
  toggleCursorGlow: () => void;
  setWallpaperPath: (path: string | null) => void;
  setWallpaperDim: (value: number) => void;
  setWallpaperBlur: (value: number) => void;
  setAdaptiveThemeEnabled: (enabled: boolean) => void;
  toggleAdaptiveTheme: () => void;
  // Backwards compatibility for existing components
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themePreset, setThemePresetState] = useState<ThemePreset>(() => {
    try {
      const saved = localStorage.getItem('soso_theme_preset') as ThemePreset;
      if (
        [
          'default',
          'sakura',
          'weather',
          'blackhole',
          'wallpaper',
          'nighttrain',
          'cassette',
        ].includes(saved)
      ) {
        return saved;
      }
      // Migrate legacy or retired presets (including rainbow)
      if (['rainbow', 'cyberpunk', 'nebula', 'sunset', 'frost'].includes(saved)) {
        return 'default';
      }
    } catch {}
    return 'default';
  });

  const [sceneIntensity, setSceneIntensity] = useState<SceneIntensity>(() => {
    try {
      const saved = localStorage.getItem('soso_scene_intensity');
      if (saved === 'quiet' || saved === 'full' || saved === 'still') return saved;
    } catch {}
    return 'full';
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-scene-intensity', sceneIntensity);
    try {
      localStorage.setItem('soso_scene_intensity', sceneIntensity);
    } catch {}
  }, [sceneIntensity]);

  const [weatherMode, setWeatherModeState] = useState<WeatherMode>(() => {
    try {
      const saved = localStorage.getItem('soso_weather_mode') as WeatherMode;
      if (saved === 'clear' || saved === 'rain') return saved;
    } catch {}
    return 'clear';
  });

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('soso_theme_mode') as ThemeMode;
      if (saved === 'light' || saved === 'dark') return saved;
      const legacy = localStorage.getItem('soso_theme');
      if (legacy === 'light' || legacy === 'dark') return legacy;
    } catch {}
    return 'dark';
  });

  const [accentColor, setAccentColorState] = useState<AccentColor>(() => {
    try {
      const saved = localStorage.getItem('soso_accent_color') as AccentColor;
      if (ACCENT_COLOR_OPTIONS.some((a) => a.id === saved)) {
        return saved;
      }
    } catch {}
    return 'emerald';
  });

  const [cursorGlow, setCursorGlowState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('soso_cursor_glow');
      return saved !== null ? saved === 'true' : false; // Default: OFF (reduces decorative slop)
    } catch {}
    return false;
  });

  const [wallpaperPath, setWallpaperPathState] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem('soso_wallpaper_path');
      return saved && saved.trim() !== '' ? saved : null;
    } catch {}
    return null;
  });

  const [wallpaperDim, setWallpaperDimState] = useState<number>(() => {
    try {
      const saved = parseInt(localStorage.getItem('soso_wallpaper_dim') || '', 10);
      if (!isNaN(saved) && saved >= 0 && saved <= 95) return saved;
    } catch {}
    return 45;
  });

  const [wallpaperBlur, setWallpaperBlurState] = useState<number>(() => {
    try {
      const saved = parseInt(localStorage.getItem('soso_wallpaper_blur') || '', 10);
      if (!isNaN(saved) && saved >= 0 && saved <= 40) return saved;
    } catch {}
    return 0;
  });

  const isAdaptiveThemeEnabled = false;
  const setAdaptiveThemeEnabled = (_enabled: boolean) => {};
  const toggleAdaptiveTheme = () => {};

  // Apply theme classes and attributes to <html>
  useEffect(() => {
    const root = document.documentElement;

    // Set data-theme, data-weather and data-accent attributes
    root.setAttribute('data-theme', themePreset);
    root.setAttribute('data-weather', weatherMode);
    root.setAttribute('data-accent', accentColor);

    // If preset is default or wallpaper, respect dark/light mode; sakura and weather-clear are light-based; weather-rain and blackhole are dark-based
    const isDark =
      themePreset === 'default' || themePreset === 'wallpaper'
        ? themeMode === 'dark'
        : themePreset === 'sakura'
          ? false
          : themePreset === 'weather'
            ? weatherMode === 'rain'
            : true;

    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Set dynamic RGB for accent and glow
    const selectedAccent =
      ACCENT_COLOR_OPTIONS.find((a) => a.id === accentColor) || ACCENT_COLOR_OPTIONS[0];

    if (themePreset === 'default') {
      root.style.setProperty('--theme-accent', selectedAccent.color);
      root.style.setProperty('--theme-accent-rgb', selectedAccent.rgb);
    } else if (themePreset === 'sakura') {
      root.style.setProperty('--theme-accent', '#f43f5e');
      root.style.setProperty('--theme-accent-rgb', '244, 63, 94');
    } else if (themePreset === 'weather') {
      if (weatherMode === 'rain') {
        root.style.setProperty('--theme-accent', '#38bdf8');
        root.style.setProperty('--theme-accent-rgb', '56, 189, 248');
      } else {
        root.style.setProperty('--theme-accent', '#10b981');
        root.style.setProperty('--theme-accent-rgb', '16, 185, 129');
      }
    } else if (themePreset === 'nighttrain') {
      root.style.setProperty('--theme-accent', '#7dd3fc');
      root.style.setProperty('--theme-accent-rgb', '125, 211, 252');
    } else if (themePreset === 'cassette') {
      root.style.setProperty('--theme-accent', '#fbbf77');
      root.style.setProperty('--theme-accent-rgb', '251, 191, 119');
    } else if (themePreset === 'blackhole') {
      root.style.setProperty('--theme-accent', '#fb923c');
      root.style.setProperty('--theme-accent-rgb', '251, 146, 60');
    } else if (themePreset === 'wallpaper') {
      root.style.setProperty('--theme-accent', selectedAccent.color);
      root.style.setProperty('--theme-accent-rgb', selectedAccent.rgb);
    }

    try {
      localStorage.setItem('soso_theme_preset', themePreset);
      localStorage.setItem('soso_theme_mode', themeMode);
      localStorage.setItem('soso_weather_mode', weatherMode);
      localStorage.setItem('soso_accent_color', accentColor);
      localStorage.setItem('soso_theme', isDark ? 'dark' : 'light');
      localStorage.setItem('soso_cursor_glow', String(cursorGlow));
    } catch (e) {
      console.warn('Failed to save theme in localStorage:', e);
    }
  }, [themePreset, themeMode, weatherMode, accentColor, cursorGlow]);

  const setThemePreset = (preset: ThemePreset) => {
    setThemePresetState(preset);
  };

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
  };

  const setWeatherMode = (mode: WeatherMode) => {
    setWeatherModeState(mode);
  };

  const toggleWeatherMode = () => {
    setWeatherModeState((prev) => (prev === 'clear' ? 'rain' : 'clear'));
  };

  const setAccentColor = (accent: AccentColor) => {
    setAccentColorState(accent);
  };

  const toggleThemeMode = () => {
    setThemeModeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const setCursorGlow = (enabled: boolean) => {
    setCursorGlowState(enabled);
  };

  const toggleCursorGlow = () => {
    setCursorGlowState((prev) => !prev);
  };

  const setWallpaperPath = (path: string | null) => {
    setWallpaperPathState(path && path.trim() !== '' ? path : null);
    try {
      if (path && path.trim() !== '') {
        localStorage.setItem('soso_wallpaper_path', path);
      } else {
        localStorage.removeItem('soso_wallpaper_path');
      }
    } catch (e) {
      console.warn('Failed to save wallpaper path:', e);
    }
  };

  const setWallpaperDim = (value: number) => {
    const clamped = Math.max(0, Math.min(95, Math.round(value)));
    setWallpaperDimState(clamped);
    try {
      localStorage.setItem('soso_wallpaper_dim', String(clamped));
    } catch (e) {}
  };

  const setWallpaperBlur = (value: number) => {
    const clamped = Math.max(0, Math.min(40, Math.round(value)));
    setWallpaperBlurState(clamped);
    try {
      localStorage.setItem('soso_wallpaper_blur', String(clamped));
    } catch (e) {}
  };

  // Secret Easter Egg: Konami Code (Up Up Down Down Left Right Left Right B A) toggles Black Hole theme
  useEffect(() => {
    const konamiSequence = [
      'ArrowUp',
      'ArrowUp',
      'ArrowDown',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'ArrowLeft',
      'ArrowRight',
      'b',
      'a',
    ];
    let konamiIndex = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const expectedKey = konamiSequence[konamiIndex];
      if (e.key.toLowerCase() === expectedKey.toLowerCase()) {
        konamiIndex++;
        if (konamiIndex === konamiSequence.length) {
          konamiIndex = 0;
          setThemePresetState((prev) => {
            const next = prev === 'blackhole' ? 'default' : 'blackhole';
            try {
              localStorage.setItem('soso_theme_preset', next);
            } catch {}
            return next;
          });
        }
      } else {
        konamiIndex = 0;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Backwards compatibility
  const theme: ThemeMode =
    themePreset === 'default' || themePreset === 'wallpaper'
      ? themeMode
      : themePreset === 'sakura'
        ? 'light'
        : themePreset === 'weather'
          ? weatherMode === 'clear'
            ? 'light'
            : 'dark'
          : 'dark';
  const toggleTheme = toggleThemeMode;
  const setTheme = setThemeMode;

  return (
    <ThemeContext.Provider
      value={{
        sceneIntensity,
        setSceneIntensity,
        themePreset,
        themeMode,
        weatherMode,
        accentColor,
        cursorGlow,
        wallpaperPath,
        wallpaperDim,
        wallpaperBlur,
        isAdaptiveThemeEnabled,
        setThemePreset,
        setThemeMode,
        setWeatherMode,
        toggleWeatherMode,
        setAccentColor,
        toggleThemeMode,
        setCursorGlow,
        toggleCursorGlow,
        setWallpaperPath,
        setWallpaperDim,
        setWallpaperBlur,
        setAdaptiveThemeEnabled,
        toggleAdaptiveTheme,
        theme,
        toggleTheme,
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
