// Run: node scripts/testing/testUiResponsiveness.mjs [--report filename.json]
// --legacy-artwork-validation reproduces pre-fix URL work in the fixture bundle only.
// Production React profiling renderer; real UI and player state, isolated transport/storage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import ts from 'typescript';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../../', import.meta.url)),
  require = createRequire(import.meta.url);
const scratch = path.join(root, 'scratch');
fs.mkdirSync(scratch, { recursive: true });
const output = fs.mkdtempSync(path.join(scratch, 'ui-responsiveness-'));
const legacyArtworkValidation = process.argv.includes('--legacy-artwork-validation');
const report = path.join(
  scratch,
  process.argv[process.argv.indexOf('--report') + 1] && process.argv.includes('--report')
    ? path.basename(process.argv[process.argv.indexOf('--report') + 1])
    : 'ui-responsiveness.json',
);
const entry = `
import React, {Profiler} from 'react';
import {createRoot} from 'react-dom/client';
import {AudioProvider,useAudioState,useAudioProgress,useAudioControls} from './src/shared/context/AudioContext';
import {TrackTable} from './src/desktop/ui/components/TrackTable';
import {useMyMusicViewModel} from './src/shared/hooks/useMyMusicViewModel';
import {useArtistViewModel} from './src/shared/hooks/useArtistViewModel';
import {PlaybackSessionWriter} from './src/shared/services/playbackSession';
const saveSession=PlaybackSessionWriter.prototype.save;PlaybackSessionWriter.prototype.save=function(...args){const started=performance.now();try{return saveSession.apply(this,args);}finally{window.uiProbe.persistence.push({duration:performance.now()-started,force:!!args[1],queueLength:args[0]?.queue?.length});}};
const w=window;
localStorage.setItem('soso_crossfade_duration','0');localStorage.setItem('soso_volume_normalization','false');localStorage.setItem('soso_scrobbling','false');localStorage.setItem('soso_discord_rpc','false');
const noop=()=>{};const root=createRoot(document.getElementById('root'));
const song=(i,artwork)=>({id:'sc_'+(100000+i),title:'Measured song '+i,artist:{name:'Fixture artist '+i%30,...(artwork?{picture:artwork,picture_medium:artwork}:{})},album:{title:'Fixture album '+i%20,...(artwork?{cover:artwork,cover_small:artwork,cover_medium:artwork,cover_big:artwork,cover_xl:artwork}:{})},...(artwork?{cover_url:artwork}:{}),duration:240,preview:'',source:'soundcloud'});
function Driver(){w.uiState=useAudioState();w.uiControls=useAudioControls();return <div id="current-track">{w.uiState.currentTrack?.id||''}</div>;}
function LibraryModelProbe(){w.uiProbe.renders.LibraryModelProbe=(w.uiProbe.renders.LibraryModelProbe||0)+1;w.uiLibrary=useMyMusicViewModel();return null;}
function ArtistModelProbe(){w.uiProbe.renders.ArtistModelProbe=(w.uiProbe.renders.ArtistModelProbe||0)+1;w.uiArtist=useArtistViewModel({artistQuery:'fixture',artistName:'Fixture'});return null;}
function Clock(){const value=useAudioProgress();return <output id="clock">{value.currentTime.toFixed(3)}</output>;}
w.mountUi=(count,artwork=false)=>{w.uiLibrary=undefined;w.uiArtist=undefined;const cover=artwork?new URL('cover.svg',location.href).href:undefined;w.fixtureTracks=Array.from({length:count},(_,i)=>song(i,cover));root.render(<Profiler id="Application" onRender={(...args)=>w.uiProbe.rootProfiles.push({actualDuration:args[2]})}><AudioProvider><Driver/><Clock/><LibraryModelProbe/><ArtistModelProbe/><main style={{height:640,overflow:'auto'}}><Profiler id="TrackTable" onRender={(...args)=>w.uiProbe.profiles.push({id:args[0],phase:args[1],actualDuration:args[2],baseDuration:args[3],startTime:args[4],commitTime:args[5]})}><TrackTable tracks={w.fixtureTracks} onOpenAddToPlaylist={noop}/></Profiler></main></AudioProvider></Profiler>);};
w.switchUiTrack=index=>{const start=performance.now();const result=w.uiControls.playTrack(w.fixtureTracks[index],w.fixtureTracks);w.uiProbe.syncCommands.push(performance.now()-start);return result;};
w.tickUiClock=value=>{const audio=w.fixtureAudio;audio.currentTime=value;audio.dispatchEvent(new Event('timeupdate'));};
`;
const bootstrap = `
window.uiLegacyArtworkValidation=${legacyArtworkValidation};
window.uiProbe={renders:{},rootProfiles:[],profiles:[],persistence:[],syncCommands:[]};
class FixtureAudio extends EventTarget{
 constructor(){super();this.src='';this.currentTime=0;this.duration=240;this.paused=true;this.seeking=false;this.readyState=4;this.networkState=1;this.buffered={length:0};this.volume=.8;this.playbackRate=1;this.error=null;window.fixtureAudio=this;}
 get currentSrc(){return this.src;}getAttribute(name){return name==='src'?this.src:null;}setAttribute(name,value){if(name==='src')this.src=value;}
 removeAttribute(name){if(name==='src')this.src='';}
 load(){if(this.src)queueMicrotask(()=>{this.dispatchEvent(new Event('loadedmetadata'));this.dispatchEvent(new Event('canplay'));});}
 play(){this.paused=false;queueMicrotask(()=>{this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));});return Promise.resolve();}
 pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}canPlayType(){return '';}
}
window.createFixtureAudio=()=>new FixtureAudio();
`;
try {
  await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: root },
    bundle: true,
    platform: 'browser',
    jsx: 'automatic',
    keepNames: true,
    outfile: path.join(output, 'fixture.js'),
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'profiling-renderer-and-transport-fixtures',
        setup(builder) {
          // Count actual production component invocations in this fixture only.
          // React 19 no longer exposes the private injectProfilingHooks API.
          builder.onLoad({ filter: /[\\/](TrackTable|TrackRow)\.tsx$/ }, (args) => {
            const contents = fs.readFileSync(args.path, 'utf8');
            const name = path.basename(args.path, '.tsx');
            const tree = ts.createSourceFile(
              args.path,
              contents,
              ts.ScriptTarget.Latest,
              true,
              ts.ScriptKind.TSX,
            );
            let body;
            function visit(node) {
              if (
                ts.isVariableDeclaration(node) &&
                node.name.getText(tree) === name &&
                node.initializer
              ) {
                const value = ts.isCallExpression(node.initializer)
                  ? node.initializer.arguments[0]
                  : node.initializer;
                if (
                  (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) &&
                  ts.isBlock(value.body)
                )
                  body = value.body;
              }
              ts.forEachChild(node, visit);
            }
            visit(tree);
            if (!body) throw Error('Missing production render body: ' + name);
            const at = body.getStart(tree) + 1;
            const counter = `\n(window as any).uiProbe.renders[${JSON.stringify(name)}]=((window as any).uiProbe.renders[${JSON.stringify(name)}]||0)+1;\n`;
            return {
              contents: contents.slice(0, at) + counter + contents.slice(at),
              loader: 'tsx',
            };
          });
          builder.onLoad({ filter: /[\\/]playbackSession\.ts$/ }, (args) => {
            if (!legacyArtworkValidation) return;
            let contents = fs.readFileSync(args.path, 'utf8');
            for (const guard of [
              '  if (!result) return undefined;',
              '  if (cache.has(result)) return cache.get(result);',
              '  cache.set(result, stable);',
            ]) {
              if (!contents.includes(guard))
                throw Error('Legacy fixture transform requires review: ' + guard);
              contents = contents.replace(guard, '');
            }
            return { contents, loader: 'ts' };
          });
          builder.onResolve({ filter: /^react-dom\/client$/ }, () => ({
            path: require.resolve('react-dom/profiling'),
          }));
          builder.onResolve(
            {
              filter:
                /(?:bridge\/platformBridge|services\/(?:offlineCacheService|audioCacheService|createPlayerAudio|playbackLogger))\.(?:ts|tsx)$/,
            },
            (args) => ({ path: args.path.replace(/\.(?:ts|tsx)$/, ''), namespace: 'ui-fixture' }),
          );
          builder.onResolve(
            {
              filter:
                /(?:bridge\/platformBridge|services\/(?:offlineCacheService|audioCacheService|createPlayerAudio|playbackLogger))$/,
            },
            (args) => ({ path: args.path, namespace: 'ui-fixture' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'ui-fixture' }, (args) => {
            let contents;
            if (args.path.endsWith('createPlayerAudio'))
              contents =
                'export const createPlayerAudio=()=>window.createFixtureAudio();export const preparePlayerAudio=()=>{};export const releasePlayerAudio=()=>{};';
            else if (args.path.endsWith('playbackLogger'))
              contents = 'export const PlaybackLogger={info(){},debug(){},warn(){},error(){}};';
            else if (args.path.endsWith('audioCacheService'))
              contents =
                'export class AudioCacheService{static isHlsUrl(){return false;}};export const audioCacheService=new Proxy({getCachedBlobUrl:()=>null,prefetchTrack:async()=>null,getOrFetchBlobUrl:async()=>null},{get:(o,k)=>o[k]||(()=>{})});';
            else if (args.path.endsWith('offlineCacheService'))
              contents =
                'export const subscribeOfflineCacheChanges=()=>()=>{};export const offlineCacheService=new Proxy({getAllCachedTracks:async()=>[],getCachedTrackUrl:async()=>null,getCachedCoverUrl:async()=>null,ownsBlobUrl:()=>false},{get:(o,k)=>o[k]||(()=>{})});';
            else
              contents =
                'export const isElectron=true;export const platformBridge=new Proxy({getLibraryStats:async()=>{if(!window.uiLibraryStatsLoaded)await new Promise(resolve=>setTimeout(resolve,500));window.uiLibraryStatsLoaded=true;return {tracks:0,playlists:0,albums:0,artists:0,durationSeconds:1};},getLibraryPage:async request=>({kind:request.kind,offset:request.offset,items:[],total:0,nextOffset:null}),getArtistMembership:async()=>[],getTastePolicy:async()=>({revision:0,exclusions:[]}),onTastePolicyChanged:()=>()=>{},getFullStreamUrl:async()=>"https://fixture.invalid/audio.mp3",getLikedTrackIds:async()=>[],getDislikedTrackIds:async()=>[],getLikedTracks:async()=>[],getSavedAlbums:async()=>[],getFollowedArtists:async()=>[],getTopScrobbledArtists:async()=>[],getWaveBatch:async()=>[]},{get:(o,k)=>o[k]||(async()=>null)});';
            return { contents, loader: 'js' };
          });
        },
      },
    ],
  });
  const css = await postcss([tailwind({ base: root })]).process(
    fs.readFileSync(path.join(root, 'src/renderer/index.css'), 'utf8'),
    {
      from: path.join(root, 'src/renderer/index.css'),
    },
  );
  fs.writeFileSync(path.join(output, 'fixture.css'), css.css);
  fs.writeFileSync(
    path.join(output, 'cover.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#346e8b"/></svg>',
  );
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><html class="dark"><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script>' +
      bootstrap +
      '</script><script src="fixture.js"></script></html>',
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(
    require('electron'),
    [path.join(root, 'scripts/testing/uiResponsivenessProbe.cjs'), output, report],
    { cwd: root, env, windowsHide: true, stdio: 'inherit', timeout: 90000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('UI responsiveness probe failed: ' + result.status);
  console.log('UI_RESPONSIVENESS_REPORT', report);
} finally {
  if (path.dirname(output) !== scratch || !path.basename(output).startsWith('ui-responsiveness-'))
    throw Error('Unexpected fixture directory');
  fs.rmSync(output, { recursive: true, force: true });
}
