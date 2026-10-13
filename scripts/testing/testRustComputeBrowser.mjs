import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  require = createRequire(import.meta.url);
const scratch = path.join(root, 'scratch'),
  output = fs.mkdtempSync(path.join(scratch, 'rust-browser-'));
const csp = fs
  .readFileSync(path.join(root, 'index.html'), 'utf8')
  .match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
if (!csp) throw Error('Missing production CSP');
const fixture = `
import {initializeRustCompute,createWaveSongMatrix} from './src/shared/compute/waveSongMatrix';
import {buildWaveSongIdentity,areSameWaveSong} from './src/shared/utils/waveIdentity';
import {sequenceWaveTracks} from './src/shared/utils/waveQueue';
import {sequenceWaveTracks as reference} from './tests/fixtures/waveSequenceReference.mjs';
window.computeResult=(async()=>{
 const titles=['Smells Like Teen Spirit','Smells Like Teen’s Spirit (Live)','MARTIN ROSE','MARTINE ROSE','Golden horizon beyond mountains','Золотой рассвет над городом','ΟΣ İ 𐐀𐐨 title','After Storm Chapter1','After Storm Chapter2'];
 const tracks=Array.from({length:120},(_,i)=>({id:'sc_'+i,title:titles[i%titles.length],duration:180+i%40,artist:{name:i%3?'Artist '+i%13:'Nirvana'},album:{title:'Single'},source:i%2?'soundcloud':'youtube'}));
 const songs=tracks.map(track=>buildWaveSongIdentity(track));
 if(createWaveSongMatrix(songs,[],[])!==null)throw Error('Fallback before initialization is unavailable');
 const response=await fetch(new URL('compute/soso-core.wasm',document.baseURI));
 if(!response.ok||!await initializeRustCompute(await response.arrayBuffer()))throw Error('Packaged local Rust module did not initialize under production CSP');
 const matrix=createWaveSongMatrix(songs,songs.slice(0,40),songs.slice(40,80));
 if(!matrix)throw Error('Runtime used fallback instead of Rust');
 for(let i=0;i<songs.length;i++)for(let j=0;j<songs.length;j++)if(matrix.sameSong(i,j)!==areSameWaveSong(songs[i],songs[j]))throw Error('Chromium ordered pair mismatch '+i+','+j);
 for(const mood of ['default','energy','chill','discover','mix','favorites']){
  const options={recentTracks:tracks.slice(0,20),offeredTracks:tracks.slice(20,40)};
  if(JSON.stringify(sequenceWaveTracks(tracks,mood,['Nirvana'],25,options))!==JSON.stringify(reference(tracks,mood,['Nirvana'],25,options)))throw Error('Chromium queue changed: '+mood);
 }
 let dynamicJavaScriptBlocked=false;try{new Function('return 1')();}catch(error){dynamicJavaScriptBlocked=error instanceof EvalError;}
 if(!dynamicJavaScriptBlocked)throw Error('CSP unexpectedly allowed general JavaScript eval');
 return {ok:true,orderedPairs:14400,modes:6,localAsset:true,dynamicJavaScriptBlocked,unicode:process?.versions?.unicode};
})().catch(error=>({ok:false,message:error.message,stack:error.stack}));
`.replace(',unicode:process?.versions?.unicode', '');
try {
  await build({
    stdin: { contents: fixture, resolveDir: root, loader: 'ts' },
    bundle: true,
    platform: 'browser',
    outfile: path.join(output, 'fixture.js'),
  });
  fs.mkdirSync(path.join(output, 'compute'));
  fs.copyFileSync(
    path.join(root, 'public/compute/soso-core.wasm'),
    path.join(output, 'compute/soso-core.wasm'),
  );
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
      csp +
      '"><script src="fixture.js"></script>',
  );
  const main = `const{app,BrowserWindow,session}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));const timer=setTimeout(()=>app.exit(1),30000);app.whenReady().then(async()=>{let external=0;session.defaultSession.webRequest.onBeforeRequest((details,reply)=>{const ok=/^(file|data|devtools):/.test(details.url);if(!ok)external++;reply({cancel:!ok});});const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});await win.loadFile(path.join(__dirname,'index.html'));const result=await win.webContents.executeJavaScript('window.computeResult');console.log('RUST_CHROMIUM_OK '+JSON.stringify({...result,externalRequests:external}));clearTimeout(timer);win.destroy();app.exit(result?.ok&&external===0?0:1);}).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1);});`;
  fs.writeFileSync(path.join(output, 'main.cjs'), main);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [path.join(output, 'main.cjs')], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: 'inherit',
    timeout: 35000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Rust Chromium integration failed: ' + result.status);
} finally {
  if (path.dirname(output) !== scratch || !path.basename(output).startsWith('rust-browser-'))
    throw Error('Unsafe fixture directory');
  fs.rmSync(output, { recursive: true, force: true });
}
