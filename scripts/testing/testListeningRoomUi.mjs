import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const output = path.join(root, 'scratch/listening-room-ui');
fs.mkdirSync(output, { recursive: true });
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Sidebar} from './src/desktop/ui/components/Sidebar';
    import {ListeningRoomScreen} from './src/desktop/ui/pages/ListeningRoomScreen';
    window.electronAPI={getPlaylists:async()=>[]};
    function Fixture(){
      const [session,setSession]=useState({status:'idle'});
      window.fixtureConnected=()=>setSession({status:'connected',name:'Вечер с друзьями',role:'host',selfId:'one',latencyMs:24,invitation:'SOSO1.example.invitation',members:[{id:'one',name:'CatJAM',isHost:true},{id:'two',name:'Аня',isHost:false}],playback:{track:{id:'one',source:'youtube',title:'Midnight City',artist:'M83',album:'',duration:240},queue:[{id:'two',entryId:'queue:two',source:'soundcloud',title:'Outro',artist:'M83',album:'',duration:220}],position:32,playing:true}});
      window.fixtureIdle=()=>setSession({status:'idle'});
      return <div style={{display:'flex',height:'100vh',background:'#0c0c10','--theme-accent':'#e9b900'}}><Sidebar currentView="listening-room" onNavigate={()=>{}} onOpenCreatePlaylist={()=>{}} onOpenSettings={()=>{}} refreshPlaylistsTrigger={0}/><main style={{padding:'30px',flex:1,overflow:'auto',minWidth:0}}><ListeningRoomScreen session={session} busy={false} error={null} initialName="CatJAM" onCreate={payload=>window.fixtureSubmitted=payload} onJoin={payload=>window.fixtureJoined=payload} onLeave={()=>setSession({status:'idle'})} onBrowse={()=>window.fixtureBrowse="search"} onBrowseLibrary={()=>window.fixtureBrowse="liked"}/></main></div>
    }createRoot(document.getElementById('root')).render(<Fixture/>);
  `,
  },
  outfile: path.join(output, 'fixture.js'),
  bundle: true,
  jsx: 'automatic',
  platform: 'browser',
  loader: { '.png': 'file' },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'isolate-room-ui',
      setup(builder) {
        builder.onLoad({ filter: /shared[/\\]context[/\\]AudioContext\.tsx$/ }, () => ({
          loader: 'js',
          contents: 'export const useAudioState=()=>({likedTrackIds:new Set()});',
        }));
        builder.onLoad({ filter: /shared[/\\]bridge[/\\]platformBridge\.ts$/ }, () => ({
          loader: 'js',
          contents: 'export const platformBridge={getLibraryStats:async()=>({tracks:44})};',
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
fs.cpSync(path.join(root, 'public/fonts'), path.join(output, 'fonts'), { recursive: true });
fs.writeFileSync(
  path.join(output, 'index.html'),
  '<!doctype html><html class="dark"><meta charset="utf-8"><link rel="stylesheet" href="fonts/fonts.css"><link rel="stylesheet" href="base.css"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script></html>',
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(
  require('electron'),
  [path.join(root, 'scripts/testing/listeningRoomUiProbe.cjs'), output],
  { cwd: root, env, windowsHide: true, stdio: 'inherit', timeout: 45000 },
);
if (result.error) throw result.error;
if (result.status !== 0) throw Error('Listening room UI failed: ' + result.status);
