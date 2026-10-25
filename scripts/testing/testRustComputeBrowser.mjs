import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  require = createRequire(import.meta.url);
const scratch = path.join(root, 'scratch'),
  output = fs.mkdtempSync(path.join(scratch, 'rust-browser-'));
const csp = fs
  .readFileSync(path.join(root, 'index.html'), 'utf8')
  .match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
if (!csp) throw Error('Missing production CSP');
const fixture = `
import {initializeRustCompute,probe} from './src/shared/compute/rustCore.ts';
import {createWaveSongMatrix} from './src/shared/compute/waveSongMatrix.ts';
import {buildWaveSongIdentity} from './src/shared/utils/waveIdentity.ts';
import {sequenceWaveTracks,resequenceWaveQueue} from './src/shared/utils/waveQueue.ts';
import {resequenceWaveQueueInWorker,disposeWaveWorker} from './src/shared/compute/waveWorkerClient.ts';
import * as reference from './tests/fixtures/waveBeforeFullRust.mjs';
import {rankingCase,moods} from './tests/helpers/waveRankingCases.mjs';
window.computeResult=(async()=>{
 const bytes=await (await fetch(new URL('compute/soso-core.wasm',document.baseURI))).arrayBuffer();
 if(!await initializeRustCompute(bytes))throw Error('Required Rust module failed under production CSP');
 if(!await reference.initializeRustCompute(await (await fetch(new URL('compute/reference.wasm',document.baseURI))).arrayBuffer()))throw Error('Reference module failed');
 const c=rankingCase(120,40,80,3),songs=c.tracks.map(t=>buildWaveSongIdentity(t));
 const matrix=createWaveSongMatrix(songs,[],[]);if(!matrix)throw Error('Missing native matrix');
 for(let i=0;i<songs.length;i++)for(let j=0;j<songs.length;j++)
  if(matrix.sameSong(i,j)!==reference.areSameWaveSong(songs[i],songs[j]))throw Error('Ordered pair mismatch');
 for(const mood of moods){
  const args=[c.tracks,mood,c.familiar,c.limit,c.options],before=probe.calls;
  if(JSON.stringify(sequenceWaveTracks(...args))!==JSON.stringify(reference.sequenceWaveTracks(...args)))throw Error('Queue changed '+mood);
  if(probe.calls!==before+1)throw Error('Queue must execute exactly one native job');
  const reseq=[c.tracks,-1,mood,c.familiar,c.options.artistFeedback,c.options.recentTracks,c.options.offeredTracks,c.options];
  const expected=resequenceWaveQueue(...reseq),syncCalls=probe.calls;
  const actual=await resequenceWaveQueueInWorker(...reseq);
  if(probe.calls!==syncCalls)throw Error('Worker calculation ran on the renderer thread');
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Worker queue changed '+mood);
  if(actual.some(track=>!c.tracks.includes(track)))throw Error('Worker replaced Track objects');
 }
 const large=rankingCase(1000,300,1000);let ticks=0,maxGap=0,last=performance.now();
 const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},4);
 const start=performance.now();
 const result=await resequenceWaveQueueInWorker(large.tracks,-1,'mix',large.familiar,large.options.artistFeedback,large.options.recentTracks,large.options.offeredTracks,large.options);
 const elapsedMs=performance.now()-start;clearInterval(timer);disposeWaveWorker();
 if(result.length!==1000 || ticks<3)throw Error('Renderer heartbeat stalled during worker computation');
 let dynamicJavaScriptBlocked=false;try{new Function('return 1')();}catch(error){dynamicJavaScriptBlocked=error instanceof EvalError;}
 if(!dynamicJavaScriptBlocked)throw Error('CSP unexpectedly allowed general JavaScript eval');
 return {ok:true,orderedPairs:14400,modes:6,workerModes:6,workerTracks:1000,elapsedMs,ticks,maxGapMs:maxGap,dynamicJavaScriptBlocked};
})().catch(error=>({ok:false,message:error.message,stack:error.stack}));
`;
try {
  const built = path.join(output, 'built');
  fs.writeFileSync(
    path.join(output, 'entry.ts'),
    fixture
      .replaceAll("from './src/", "from '../../src/")
      .replaceAll("from './tests/", "from '../../tests/"),
  );
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
      csp +
      '"><script type="module" src="./entry.ts"></script>',
  );
  // Compile only this isolated fixture, using Vite's actual worker asset transformation.
  await build({
    configFile: false,
    root: output,
    base: './',
    logLevel: 'warn',
    plugins: [
      {
        name: 'observe-native-job',
        enforce: 'pre',
        transform(code, id) {
          if (!/[/\\]rustCore\.ts$/.test(id)) return;
          const contents =
            code.replace('export function runRustCompute(', 'function observedRunRustCompute(') +
            '\nexport const probe={calls:0};export function runRustCompute(...args:Parameters<typeof observedRunRustCompute>){if(args[0]==="sequence_wave")probe.calls++;return observedRunRustCompute(...args);}';
          return { code: contents, map: null };
        },
      },
    ],
    build: { outDir: built, minify: false },
  });
  fs.mkdirSync(path.join(built, 'compute'));
  fs.copyFileSync(
    path.join(root, 'public/compute/soso-core.wasm'),
    path.join(built, 'compute/soso-core.wasm'),
  );
  fs.copyFileSync(
    path.join(root, 'tests/fixtures/waveBeforeFullRust.wasm'),
    path.join(built, 'compute/reference.wasm'),
  );
  const main = `const{app,BrowserWindow,session}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));const timer=setTimeout(()=>app.exit(1),30000);app.whenReady().then(async()=>{let external=0;session.defaultSession.webRequest.onBeforeRequest((details,reply)=>{const ok=/^(file|data|devtools):/.test(details.url);if(!ok)external++;reply({cancel:!ok});});const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});await win.loadFile(path.join(__dirname,'built/index.html'));const result=await win.webContents.executeJavaScript('window.computeResult');require('node:fs').writeFileSync(path.join(__dirname,'..','rust-chromium-result.json'),JSON.stringify({...result,externalRequests:external,electron:process.versions.electron,chromium:process.versions.chrome},null,2));console.log('RUST_CHROMIUM_OK '+JSON.stringify({...result,externalRequests:external}));clearTimeout(timer);win.destroy();app.exit(result?.ok&&external===0?0:1);}).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1);});`;
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
