import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  require = createRequire(import.meta.url);
const scratch = path.join(root, 'scratch'),
  folder = fs.mkdtempSync(path.join(scratch, 'background-memory-'));
try {
  const contents = `
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BlackHoleBackground} from './src/shared/components/BlackHoleBackground';
import {WeatherEffects} from './src/shared/components/WeatherEffects';
import {ListeningSceneBackground} from './src/shared/components/ListeningSceneBackground';
import {WallpaperBackground} from './src/shared/components/WallpaperBackground';
window.state={themePreset:'blackhole',weatherMode:'rain',sceneIntensity:'quiet',paused:false,wallpaperPath:'tone.wav',wallpaperDim:0,wallpaperBlur:0};
window.paint=()=>window.dispatchEvent(new Event('change-fixture'));
const root=createRoot(document.getElementById('root'));
root.render(<><BlackHoleBackground/><WeatherEffects/><ListeningSceneBackground/><WallpaperBackground/></>);
window.ready=true;`;
  await build({
    stdin: { contents, loader: 'tsx', resolveDir: root },
    outfile: path.join(folder, 'renderer.js'),
    bundle: true,
    jsx: 'automatic',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'background-fixture',
        setup(builder) {
          builder.onResolve(
            { filter: /(?:context\/(?:ThemeContext|AudioContext)|hooks\/useAnimationsPaused)$/ },
            (args) => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'js',
            resolveDir: root,
            contents:
              "import {useState,useEffect} from 'react';function state(){const [,redraw]=useState(0);useEffect(()=>{const change=()=>redraw(x=>x+1);window.addEventListener('change-fixture',change);return()=>window.removeEventListener('change-fixture',change);},[]);return window.state;}" +
              (args.path === 'ThemeContext'
                ? 'export const useTheme=state;'
                : args.path === 'AudioContext'
                  ? 'export const useAudioState=()=>({isPlaying:false});'
                  : 'export const useAnimationsPaused=()=>state().paused;'),
          }));
        },
      },
    ],
  });
  fs.copyFileSync(path.join(root, 'public/icon.png'), path.join(folder, 'local-fixture.png'));
  fs.writeFileSync(
    path.join(folder, 'index.html'),
    '<!doctype html><div id="root"></div><script src="renderer.js"></script>',
  );
  const main = `
const {app,BrowserWindow,protocol}=require('electron');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');
protocol.registerSchemesAsPrivileged([{scheme:'media',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const folder=process.argv[2];app.setPath('userData',path.join(folder,'profile'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 protocol.handle('media',()=>new Response(fs.readFileSync(path.join(folder,'local-fixture.png')),{headers:{'content-type':'image/png'}}));
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 await win.loadFile(path.join(folder,'index.html'));await delay(300);
 const results=[];
 for(const theme of ['blackhole','weather','nighttrain','cassette']){
  await win.webContents.executeJavaScript("Object.assign(state,{themePreset:"+JSON.stringify(theme)+",paused:false});paint();");await delay(150);
  const visible=await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('canvas')).map(c=>({width:c.width,height:c.height}))");
  assert.ok(visible.some(c=>c.width>0&&c.height>0),theme+' should have a visible canvas');
  await win.webContents.executeJavaScript("state.paused=true;paint();");await delay(100);
  const hidden=await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('canvas')).map(c=>({width:c.width,height:c.height}))");
  assert.ok(hidden.every(c=>c.width===0&&c.height===0),theme+' must release hidden buffers');
  await win.webContents.executeJavaScript("state.paused=false;paint();");await delay(100);
  assert.ok(await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('canvas')).some(c=>c.width>0&&c.height>0)"),theme+' must redraw after restore');
  results.push({theme,visible,hidden});
 }
 await win.webContents.executeJavaScript("Object.assign(state,{themePreset:'wallpaper',wallpaperPath:new URL('local-fixture.png',document.baseURI).href,paused:false});paint();");await delay(100);
 assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('img,video').length"),1);
 await win.webContents.executeJavaScript("state.paused=true;paint();");await delay(100);
 assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('img,video').length"),0);
 fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify({ok:true,results,wallpaperReleased:true},null,2));
 console.log('Decorative canvases release buffers on hide and restore on show; wallpaper unmounts.');win.destroy();app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});`;
  fs.writeFileSync(path.join(folder, 'main.cjs'), main);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [path.join(folder, 'main.cjs'), folder], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: 'inherit',
    timeout: 25000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Background resource regression: ' + result.status);
  fs.copyFileSync(
    path.join(folder, 'result.json'),
    path.join(scratch, 'background-memory-result.json'),
  );
} finally {
  if (path.dirname(folder) !== scratch || !path.basename(folder).startsWith('background-memory-'))
    throw new Error('Unexpected test directory');
  fs.rmSync(folder, { recursive: true, force: true });
}
