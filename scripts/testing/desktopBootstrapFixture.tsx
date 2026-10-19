import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, useTheme } from '../../src/shared/context/ThemeContext';
import { WallpaperBackground } from '../../src/shared/components/WallpaperBackground';

// The screen is deliberately small; main, preload, theme persistence and media
// components are the production implementations, without replacement IPC handlers.
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
function Probe() {
  const theme = useTheme();
  const [result, setResult] = useState('ready');
  const run = async (action: string) => {
    try {
      let value;
      if (action === 'select') {
        value = await window.electronAPI!.selectWallpaperVideo!();
        if (!value.success || !value.filePath) throw Error('Native selection failed');
        theme.setWallpaperPath(value.filePath);
        theme.setThemePreset('wallpaper');
      } else if (action === 'start') value = await window.electronAPI!.startLanSync!();
      else value = await window.electronAPI!.stopLanSync!();
      setResult(JSON.stringify(value));
    } catch (error) {
      setResult(JSON.stringify({ error: String(error) }));
    }
  };
  return (
    <>
      <WallpaperBackground />
      <button data-probe="select" onClick={() => void run('select')}>
        Select wallpaper
      </button>
      <button data-probe="start" onClick={() => void run('start')}>
        Start sync
      </button>
      <button data-probe="stop" onClick={() => void run('stop')}>
        Stop sync
      </button>
      <output data-probe="result">{result}</output>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <Probe />
  </ThemeProvider>,
);
