import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'scratch/listening-room-playback');
fs.mkdirSync(output, { recursive: true });
const require = createRequire(import.meta.url);
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
    import React,{useEffect,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {AudioProvider,useAudioState,useAudioControls,useAudioProgress} from './src/shared/context/AudioContext';
    import {useListeningRoomPlayback} from './src/desktop/ui/hooks/useListeningRoomPlayback';
    import {useRoomSession,requestRoom} from './src/desktop/ui/services/listeningRoomClient';
    import {ListeningRoomView} from './src/desktop/ui/pages/ListeningRoomView';
    import {initializeRustCompute} from './src/shared/compute/rustCore';
    const config=new URLSearchParams(location.search);
    localStorage.setItem('soso_room_name',config.get('role'));
    localStorage.setItem('soso_crossfade_duration','0');
    localStorage.setItem('soso_wave_scrobbling','false');
    function Controller(){useListeningRoomPlayback();return null;}
    function Fixture(){
      const audio=useAudioState(),controls=useAudioControls(),progress=useAudioProgress(),room=useRoomSession();
      const [controller,setController]=useState(true);
      useEffect(()=>{window.roomProbe={audio,controls,progress,room,requestRoom,setController};},[audio,controls,progress,room]);
      return <>{controller&&<Controller/>}<ListeningRoomView onNavigate={()=>{}}/></>;
    }
    (async()=>{
      await initializeRustCompute(await(await fetch('compute/soso-core.wasm')).arrayBuffer());
      createRoot(document.getElementById('root')).render(<AudioProvider><Fixture/></AudioProvider>);
    })().catch(error=>{window.fixtureError=String(error);});
  `,
  },
  outfile: path.join(output, 'fixture.js'),
  bundle: true,
  jsx: 'automatic',
  platform: 'browser',
  format: 'esm',
  loader: { '.png': 'file' },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'local-music-catalog',
      setup(builder) {
        builder.onLoad({ filter: /shared[/\\]bridge[/\\]platformBridge\.ts$/ }, () => ({
          loader: 'js',
          contents: `
      const conf=new URLSearchParams(location.search);
      const origin=conf.get('audio');
      export const platformBridge=new Proxy({
        getFullStreamUrl:async track=>{if(track.id==='sc_room_1'){window.roomFirstResolveAt=performance.now();await new Promise(r=>setTimeout(r,3000));}return origin+'/audio.wav?track='+encodeURIComponent(track.id);},
        getLibraryStats:async()=>({tracks:0}),
        onRecordingAliasesChanged:()=>()=>{},
      },{get:(target,key)=>target[key]??(async()=>[])});
    `,
        }));
      },
    },
  ],
});
await build({
  entryPoints: [path.join(root, 'src/desktop/preload/index.ts')],
  outfile: path.join(output, 'preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
await build({
  entryPoints: [path.join(root, 'src/desktop/main/services/listeningRooms.ts')],
  outfile: path.join(output, 'bridge.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  plugins: [
    {
      name: 'fixture-app-root',
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({
          path: 'electron',
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            'export const app={isPackaged:false,getAppPath:()=>' + JSON.stringify(root) + '};',
        }));
      },
    },
  ],
});
const css = await postcss([tailwind({ base: root })]).process(
  fs.readFileSync(path.join(root, 'src/renderer/index.css'), 'utf8'),
  { from: path.join(root, 'src/renderer/index.css') },
);
fs.writeFileSync(path.join(output, 'base.css'), css.css);
fs.cpSync(path.join(root, 'public/compute'), path.join(output, 'compute'), { recursive: true });
fs.cpSync(path.join(root, 'public/fonts'), path.join(output, 'fonts'), { recursive: true });
fs.writeFileSync(
  path.join(output, 'index.html'),
  '<!doctype html><html class="dark"><meta charset="utf-8"><link rel="stylesheet" href="fonts/fonts.css"><link rel="stylesheet" href="base.css"><link rel="stylesheet" href="fixture.css"><body style="margin:24px;background:#0c0c10"><div id="root"></div><script type="module" src="fixture.js"></script></body></html>',
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(
  require('electron'),
  [path.join(root, 'scripts/testing/listeningRoomPlaybackProbe.cjs'), output, root],
  { cwd: root, env, windowsHide: true, stdio: 'inherit', timeout: 170000 },
);
if (result.error) throw result.error;
if (result.status !== 0)
  throw Error('Listening room playback integration failed: ' + result.status);
