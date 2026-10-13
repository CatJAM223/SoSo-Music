import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import config from '../../tailwind.config.js';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  require = createRequire(import.meta.url);
const scratch = path.join(root, 'scratch'),
  output = fs.mkdtempSync(path.join(scratch, 'ui-interactions-'));
const entry = `
import React,{createContext,useContext,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TrackRow as DesktopRow} from './src/desktop/ui/components/TrackRow';
import {PlayerBar as DesktopBar} from './src/desktop/ui/components/PlayerBar';
import {DiscoverView as DesktopDiscover} from './src/desktop/ui/pages/DiscoverView';
import {FixtureAudioState} from './src/shared/context/AudioContext';
const art=color=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="'+color+'"/></svg>');
window.tracks=['First','Second'].map((title,i)=>({id:'sc_'+(i+1),title,source:'soundcloud',artist:{name:'Fixture Artist'},duration:180,album:{title:'Fixture',cover:art(i?'#7b57ce':'#dfb52b')}}));
const initial={currentTrack:null,isPlaying:false,isLoadingTrack:false,isWaveStarting:false,isWaveActive:false,waveMood:'default',waveSource:'all',queue:window.tracks,likedTrackIds:new Set(),dislikedTrackIds:new Set(),cachedTrackIds:new Set(),savedAlbumIds:new Set(),followedArtistIds:new Set(),snippetTrack:null,isSnippetPlaying:false,volume:.5,isMuted:false,repeatMode:'off',isShuffle:false,isVolumeNormalizationEnabled:true,crossfadeDuration:4,sleepTimerMode:'off',sleepTimerRemaining:null};
window.actions=[];
const bridge=new Proxy({getCharts:async()=>({tracks:{data:[]}}),getLyrics:async()=>[],getChords:async()=>null},{get:(target,key)=>target[key]??(async()=>[])});
window.electronAPI=bridge;
function Fixture(){
 const [state,setState]=useState(initial),[layout,setLayout]=useState('desktop'),[mode,setMode]=useState('rows');
 window.updateFixture=patch=>setState(previous=>({...previous,...patch}));
 window.showFixture=(nextLayout,nextMode='rows')=>{window.actions=[];setState({...initial});setLayout(nextLayout);setMode(nextMode);};
 window.fixtureControls={
  playTrack:track=>{window.actions.push('play:'+track.id);setState(previous=>({...previous,currentTrack:track,isPlaying:false,isLoadingTrack:true}));},
  togglePlay:()=>{window.actions.push('toggle');setState(previous=>({...previous,isPlaying:previous.isLoadingTrack?false:!previous.isPlaying,isLoadingTrack:false}));},
  startWave:mood=>{window.actions.push('wave:'+mood);setState(previous=>({...previous,isWaveStarting:true,isWaveActive:true,isLoadingTrack:true,waveMood:mood}));},
  setWaveSource:source=>{window.actions.push('source:'+source);setState(previous=>({...previous,waveSource:source}));},
  stopWave:()=>{window.actions.push('stop-wave');setState(previous=>({...previous,isWaveStarting:false,isWaveActive:false,isLoadingTrack:false}));},
  isOfflineCached:()=>false,toggleLike:()=>window.actions.push('like'),isTrackDisliked:()=>false,
 };
 const Row=DesktopRow,Bar=DesktopBar,Discover=DesktopDiscover;
 const noop=()=>{};
 return <FixtureAudioState.Provider value={state}><div className="p-5"><button id="press-target" className="rounded-lg px-4 py-2 bg-soso-brand text-black">Control</button><button id="disabled-target" disabled className="ml-4 rounded-lg px-4 py-2">Disabled</button></div><main key={layout+mode} className="soso-view-enter px-4 pb-32">{mode==='wave'?<Discover onNavigate={noop} onNavigateToArtist={noop} onOpenAddToPlaylist={noop}/>:window.tracks.map((track,index)=><Row key={track.id} track={track} index={index} playlistContext={window.tracks} onOpenAddToPlaylist={noop}/>)}</main><Bar onToggleQueue={noop} isQueueOpen={false} onToggleLyrics={noop} onOpenMobilePlayer={noop} onOpenAddToPlaylist={noop}/></FixtureAudioState.Provider>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
try {
  await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: root },
    outfile: path.join(output, 'fixture.js'),
    bundle: true,
    jsx: 'automatic',
    platform: 'browser',
    loader: { '.png': 'file', '.webp': 'file' },
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'services-only',
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /(?:context\/(?:AudioContext|ToastContext)|bridge\/platformBridge|hooks\/useDailyRecommendations)$/,
            },
            (args) => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
            if (args.path.endsWith('AudioContext'))
              return {
                resolveDir: root,
                loader: 'js',
                contents:
                  'import React,{createContext,useContext} from "react";export const FixtureAudioState=createContext({});export const useAudioState=()=>useContext(FixtureAudioState);export const useAudioProgress=()=>({currentTime:0,duration:180,bufferedRanges:[],snippetProgress:0});export const useAudioControls=()=>new Proxy(window.fixtureControls,{get:(target,key)=>target[key]??(()=>{})});',
              };
            if (args.path.endsWith('ToastContext'))
              return { loader: 'js', contents: 'export const emitToast=()=>{};' };
            if (args.path.endsWith('useDailyRecommendations'))
              return {
                loader: 'js',
                contents: 'export const useDailyRecommendations=()=>({tracks:[]});',
              };
            return {
              loader: 'js',
              contents:
                'export const isElectron=true;export const platformBridge=new Proxy({getCharts:async()=>({tracks:{data:[]}}),getLyrics:async()=>[],getChords:async()=>null},{get:(target,key)=>target[key]??(async()=>[])});',
            };
          });
        },
      },
    ],
  });
  const css = await postcss([
    tailwind({
      ...config,
      content: [path.join(root, 'src/**/*.{ts,tsx}'), { raw: entry, extension: 'tsx' }],
    }),
    autoprefixer,
  ]).process(fs.readFileSync(path.join(root, 'src/renderer/index.css'), 'utf8'), {
    from: path.join(root, 'src/renderer/index.css'),
  });
  fs.writeFileSync(
    path.join(output, 'fixture.css'),
    css.css +
      '\n' +
      fs.readFileSync(path.join(root, 'src/desktop/ui/components/WaveControl.css'), 'utf8'),
  );
  fs.cpSync(path.join(root, 'public/fonts'), path.join(output, 'fonts'), { recursive: true });
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fonts/fonts.css"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>',
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(
    require('electron'),
    [path.join(root, 'scripts/testing/uiInteractionsProbe.cjs'), output],
    { cwd: root, stdio: 'inherit', env, windowsHide: true, timeout: 60000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('UI interaction checks failed: ' + result.status);
} finally {
  if (path.dirname(output) !== scratch || !path.basename(output).startsWith('ui-interactions-'))
    throw Error('Unsafe fixture path');
  fs.rmSync(output, { recursive: true, force: true });
}
