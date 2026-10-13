import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url)),
  require = createRequire(import.meta.url);
const scratch = path.join(root, 'scratch');
fs.mkdirSync(scratch, { recursive: true });
const output = fs.mkdtempSync(path.join(scratch, 'settings-lifecycle-'));
const entry =
  "import React,{StrictMode} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {ThemeProvider} from './src/shared/context/ThemeContext';\nimport {SettingsModal as DesktopSettings} from './src/desktop/ui/components/modals/SettingsModal';\nconst noop=()=>{};\nconst f=window.settingsFixture={\n statsReads:0,historyReads:0,cacheReads:0,lanReads:0,\n accountListeners:new Set(),offlineListeners:new Set(),lanListeners:new Set(),statsListeners:new Set(),intervals:new Set(),\n controls:{refreshLikedTracks:noop,refreshSavedAlbums:noop,refreshFollowedArtists:noop,setCrossfadeDuration:noop,toggleVolumeNormalization:noop},\n audioState:{crossfadeDuration:4,isVolumeNormalizationEnabled:true},\n};\nconst subscribe=(listeners,callback)=>{listeners.add(callback);return()=>listeners.delete(callback);};\nconst add=window.addEventListener.bind(window),remove=window.removeEventListener.bind(window);\nwindow.addEventListener=(name,listener,options)=>{if(name==='soso:stats-updated')f.statsListeners.add(listener);add(name,listener,options);};\nwindow.removeEventListener=(name,listener,options)=>{if(name==='soso:stats-updated')f.statsListeners.delete(listener);remove(name,listener,options);};\nconst interval=window.setInterval.bind(window),clearInterval=window.clearInterval.bind(window);\nwindow.setInterval=(...args)=>{const id=interval(...args);f.intervals.add(id);return id;};\nwindow.clearInterval=id=>{f.intervals.delete(id);clearInterval(id);};\nwindow.settingsBridge={\n getStats:async()=>{const plays=++f.statsReads;return {todaySeconds:60,weekly:{plays,measuredSeconds:60,uniqueTracks:1,uniqueArtists:1,activity:[],topTracks:[],topArtists:[]}};},\n getListeningHistory:async()=>{f.historyReads++;return [];},\n getLanSyncStatus:async()=>{f.lanReads++;return {active:false,addresses:[]};},\n onLanSyncImported:callback=>subscribe(f.lanListeners,callback),\n searchArtists:async()=>({data:[]}),\n};\nwindow.electronAPI={\n getLibraryTaste:async()=>({autoAnalyze:f.autoAnalyze!==false,running:false,totalTracks:73,processedTracks:73,matchedTracks:64,missingTracks:9,failedTracks:0,updatedAt:null,genres:[]}),\n setLibraryTasteAutoAnalyze:async enabled=>{f.autoAnalyze=enabled;return window.electronAPI.getLibraryTaste();},\n getYouTubeAccountStatus:async()=>({connected:false,loginOpen:false}),\n onYouTubeAccountChanged:callback=>subscribe(f.accountListeners,callback),\n};\nwindow.settingsOffline={\n getCacheStats:async()=>{f.cacheReads++;return {count:0,formattedSize:'0 MB'};},\n subscribe:callback=>subscribe(f.offlineListeners,callback),\n};\nlet currentRoot,layout,strict,open=true,revision=0;\nfunction Tree(){const Settings=DesktopSettings;\n return <ThemeProvider><div data-fixture-revision={revision}/><Settings isOpen={open} onClose={noop}/></ThemeProvider>;\n}\nfunction draw(){const tree=<Tree/>;currentRoot.render(strict?<StrictMode>{tree}</StrictMode>:tree);}\nwindow.mountSettings=(nextLayout,nextStrict)=>{\n layout=nextLayout;strict=nextStrict;open=true;revision=0;\n f.statsReads=0;f.historyReads=0;f.cacheReads=0;f.lanReads=0;f.autoAnalyze=true;\n currentRoot=createRoot(document.getElementById('root'));draw();\n};\nwindow.rerenderSettings=()=>{revision++;draw();};\nwindow.setSettingsOpen=value=>{open=value;draw();};\nwindow.unmountSettings=()=>{currentRoot.unmount();currentRoot=null;};\n";
try {
  await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: root },
    outfile: path.join(output, 'fixture.js'),
    bundle: true,
    jsx: 'automatic',
    platform: 'browser',
    loader: { '.svg': 'file', '.webp': 'file', '.png': 'file' },
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'fixture-services',
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /(?:context\/AudioContext|bridge\/platformBridge|services\/offlineCacheService)$/,
            },
            (args) => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'js',
            contents:
              args.path === 'AudioContext'
                ? 'export const useAudioControls=()=>window.settingsFixture.controls;export const useAudioState=()=>window.settingsFixture.audioState;'
                : args.path === 'platformBridge'
                  ? 'export const platformBridge=new Proxy({}, {get:(_target,key)=>{const method=window.settingsBridge[key];if(!method)throw Error("Unexpected settings bridge method: "+String(key));return method;}});'
                  : 'export const offlineCacheService={getCacheStats:(...args)=>window.settingsOffline.getCacheStats(...args)};export const subscribeOfflineCacheChanges=callback=>window.settingsOffline.subscribe(callback);',
          }));
        },
      },
    ],
  });
  if (!fs.existsSync(path.join(output, 'fixture.css')))
    throw Error('esbuild did not emit imported settings CSS');
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>',
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(
    require('electron'),
    [path.join(root, 'scripts/testing/settingsLifecycleProbe.cjs'), output],
    { cwd: root, stdio: 'inherit', env, windowsHide: true, timeout: 30000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Settings lifecycle checks failed: ' + result.status);
} finally {
  if (path.dirname(output) !== scratch || !path.basename(output).startsWith('settings-lifecycle-'))
    throw Error('Unsafe settings fixture path');
  fs.rmSync(output, { recursive: true, force: true });
}
