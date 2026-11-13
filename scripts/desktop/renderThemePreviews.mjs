// Capture the application's own background renderers, without invented artwork.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'scratch/theme-previews');
fs.mkdirSync(output, { recursive: true });
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {BlackHoleBackground} from './src/shared/components/BlackHoleBackground';
    import {ListeningSceneBackground} from './src/shared/components/ListeningSceneBackground';
    import {SakuraFallingPetals} from './src/shared/components/SakuraFallingPetals';
    import {WeatherEffects} from './src/shared/components/WeatherEffects';
    const root=createRoot(document.getElementById('root'));
    window.renderTheme=(preset,mode='dark',weatherMode='clear')=>{
      window.previewTheme={themePreset:preset,themeMode:mode,weatherMode,sceneIntensity:'full'};
      document.documentElement.dataset.theme=preset;
      document.documentElement.dataset.weather=weatherMode;
      document.documentElement.classList.toggle('dark',mode==='dark');
      root.render(<React.Fragment key={preset+mode+weatherMode}><BlackHoleBackground/><ListeningSceneBackground/><SakuraFallingPetals/><WeatherEffects/></React.Fragment>);
    };`,
  },
  bundle: true,
  jsx: 'automatic',
  outfile: path.join(output, 'scene.js'),
  plugins: [
    {
      name: 'preview-context',
      setup(b) {
        b.onResolve({ filter: /(?:ThemeContext|AudioContext|useAnimationsPaused)$/ }, (a) => ({
          path: a.path,
          namespace: 'preview',
        }));
        b.onLoad({ filter: /.*/, namespace: 'preview' }, (a) => ({
          contents: a.path.endsWith('ThemeContext')
            ? 'export const useTheme=()=>window.previewTheme;'
            : a.path.endsWith('AudioContext')
              ? 'export const useAudioState=()=>({isPlaying:true});'
              : 'export const useAnimationsPaused=()=>false;',
          loader: 'js',
        }));
      },
    },
  ],
});
const css = await postcss([tailwind({ base: root })]).process(
  fs.readFileSync(path.join(root, 'src/renderer/index.css'), 'utf8'),
  { from: path.join(root, 'src/renderer/index.css') },
);
fs.appendFileSync(path.join(output, 'scene.css'), css.css);
fs.writeFileSync(
  path.join(output, 'index.html'),
  '<meta charset="utf-8"><link rel="stylesheet" href="scene.css"><style>body{min-height:100vh}</style><div id="root"></div><script src="scene.js"></script>',
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(
  createRequire(import.meta.url)('electron'),
  [
    path.join(root, 'scripts/desktop/themePreviewCapture.cjs'),
    output,
    path.join(root, 'src/shared/components/settings/theme-previews'),
  ],
  { env, stdio: 'inherit', windowsHide: true, timeout: 45000 },
);
if (result.error) throw result.error;
if (result.status !== 0) throw Error('Theme capture failed');
