import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const scratch = path.join(root, 'scratch');
fs.mkdirSync(scratch, { recursive: true });
const folder = fs.mkdtempSync(path.join(scratch, 'overlay-resources-'));
const baselineRoot = process.argv[2];
try {
  await build({
    entryPoints: [
      path.join(baselineRoot || root, 'src/desktop/main/services/playerOverlayWindow.ts'),
    ],
    outfile: path.join(folder, 'overlay.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });
  await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {PlayerOverlay} from './src/desktop/ui/components/PlayerOverlay';createRoot(document.getElementById('root')).render(<PlayerOverlay/>);`,
      resolveDir: root,
      loader: 'tsx',
    },
    outfile: path.join(folder, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  fs.writeFileSync(
    path.join(folder, 'index.html'),
    '<!doctype html><link rel="stylesheet" href="renderer.css"><style>body{margin:0}</style><div id="root"></div><script src="renderer.js"></script>',
  );
  fs.writeFileSync(
    path.join(folder, 'preload.cjs'),
    `
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('electronAPI',{
getOverlayLayout:async()=>({track:{x:.25,y:.75},controls:{x:0,y:0}}),getOverlayEditing:async()=>false,
getOverlayLanguage:()=>ipcRenderer.invoke('fixture:overlayLanguage'),
onOverlayLanguageChanged:fn=>{const h=(_,s)=>fn(s);ipcRenderer.on('overlay:languageChanged',h);return()=>ipcRenderer.removeListener('overlay:languageChanged',h);},
getOverlayState:async()=>({track:{id:1,title:'Memory fixture',artist:{name:'Singer'},album:{}}}),
onWidgetStateUpdate:fn=>{const h=(_,s)=>fn(s);ipcRenderer.on('widget:stateUpdate',h);return()=>ipcRenderer.removeListener('widget:stateUpdate',h);},
onOverlayEditingChanged:fn=>{const h=(_,s)=>fn(s);ipcRenderer.on('overlay:editingChanged',h);return()=>ipcRenderer.removeListener('overlay:editingChanged',h);}
});`,
  );
  fs.writeFileSync(
    path.join(folder, 'main.cjs'),
    `
const {app,BrowserWindow,screen,ipcMain}=require('electron');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');
const folder=process.argv[2],baseline=process.argv[3]==='baseline';app.setPath('userData',path.join(folder,'profile'));
// Keep this isolated resource probe invisible while exercising the real window and renderer.
BrowserWindow.prototype.showInactive=function(){};BrowserWindow.prototype.show=function(){};
const delay=ms=>new Promise(r=>setTimeout(r,ms));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
const {createPlayerOverlayWindow}=require('./overlay.cjs');
const layout={track:{x:.25,y:.75},controls:{x:0,y:0}};
const overlay=createPlayerOverlayWindow(path.join(folder,'preload.cjs'),path.join(folder,'index.html'),undefined,()=>layout);
ipcMain.handle('fixture:overlayLanguage',()=>overlay.getLanguage?.()||'ru');
overlay.setLanguage?.('en');
overlay.start();const win=BrowserWindow.getAllWindows()[0];
await Promise.all([new Promise(r=>win.webContents.once('did-finish-load',r)),new Promise(r=>win.once('ready-to-show',r))]);
for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript("document.querySelector('strong')?.textContent==='Memory fixture'"))break;await delay(20);}
assert.equal(await win.webContents.executeJavaScript("document.querySelector('strong')?.textContent"),'Memory fixture');
if(!baseline){
assert.equal(await win.webContents.executeJavaScript('document.documentElement.lang'),'en');
overlay.setLanguage('ru');await delay(30);
assert.equal(await win.webContents.executeJavaScript('document.documentElement.lang'),'ru');
}
await win.webContents.executeJavaScript("window.storageEvents=0;window.addEventListener('storage',()=>window.storageEvents++);");
const writer=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
await writer.loadFile(path.join(folder,'index.html'));
await writer.webContents.executeJavaScript("for(let i=0;i<240;i++)localStorage.setItem('soso_playback_session_v1',JSON.stringify({position:i,queue:'synthetic'.repeat(8192)}));");
await delay(150);
const storageEvents=await win.webContents.executeJavaScript('window.storageEvents');
if(!baseline)assert.equal(storageEvents,0,'Playback queue writes must never enter the overlay renderer');
writer.destroy();
const view=win.getBounds();const card=await win.webContents.executeJavaScript("(()=>{const r=document.querySelector('[data-overlay-panel]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
const monitor=screen.getDisplayMatching(view),display=monitor.bounds;
if(!baseline){assert.equal(view.width,340);assert.equal(view.height,80);assert.equal(card.x,0);assert.equal(card.y,0);}
overlay.edit();assert.equal(win.getBounds().width,display.width);assert.ok(win.getBounds().height>=monitor.workArea.height);
overlay.finishEditing();if(!baseline)assert.deepEqual(win.getBounds(),view);
await delay(300);
const result={ok:true,baseline,view,card,display,storageEvents,surfacePixels:view.width*view.height,processes:app.getAppMetrics().map(m=>({type:m.type,workingSetKB:m.memory.workingSetSize}))};
fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(result,null,2));console.log('OVERLAY_RESOURCES_OK '+JSON.stringify(result));overlay.dispose();app.exit(0);
}).catch(e=>{console.error(e);app.exit(1);});`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(
    require('electron'),
    [path.join(folder, 'main.cjs'), folder, baselineRoot ? 'baseline' : 'candidate'],
    { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 30000 },
  );
  if (result.error || result.status !== 0)
    throw Error(
      (result.error?.message || 'Overlay resource probe failed') +
        '\n' +
        result.stdout +
        result.stderr,
    );
  console.log(result.stdout.trim());
  fs.copyFileSync(
    path.join(folder, 'result.json'),
    path.join(scratch, baselineRoot ? 'overlay-baseline-resources.json' : 'overlay-resources.json'),
  );
} finally {
  if (path.dirname(folder) !== scratch || !path.basename(folder).startsWith('overlay-resources-'))
    throw Error('Unexpected test directory');
  fs.rmSync(folder, { recursive: true, force: true });
}
