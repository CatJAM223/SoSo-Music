import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soso-media-electron-'));
try {
  await build({
    entryPoints: [path.join(root, 'src/desktop/main/services/mediaFileAccess.ts')],
    outfile: path.join(directory, 'media.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
  });
  fs.writeFileSync(
    path.join(directory, 'main.cjs'),
    String.raw`
const {app,BrowserWindow,protocol,net,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {MediaFileAccess,MEDIA_SCHEME,createMediaHandler}=require('./media.cjs');
const directory=__dirname;
app.setPath('userData',path.join(directory,'profile'));
protocol.registerSchemesAsPrivileged([MEDIA_SCHEME]);
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));
 const image=path.join(directory,'image #1.png'),secret=path.join(directory,'secret.txt');
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 fs.writeFileSync(image,bytes);fs.writeFileSync(secret,'private fixture');
 const access=new MediaFileAccess(directory),url=access.select(image);
 protocol.handle('media',createMediaHandler(access));
 const html=path.join(directory,'index.html');
 fs.writeFileSync(html,'<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src media:; connect-src media:"><body>');
 const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
 await window.loadFile(html);
 const result=await window.webContents.executeJavaScript('('+ (async(url)=>{
   const image=new Image();image.src=url;
   await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Selected wallpaper did not load'));});
   const response=await fetch(url,{headers:{Range:'bytes=0-7'}});
   const bytes=Array.from(new Uint8Array(await response.arrayBuffer()));
   const head=await fetch(url,{method:'HEAD'});
   const forbidden=await fetch('media://local/?path='+encodeURIComponent('C:/Windows/win.ini'));
   return {width:image.naturalWidth,status:response.status,range:response.headers.get('Content-Range'),bytes,head:head.status,headSize:(await head.arrayBuffer()).byteLength,forbidden:forbidden.status};
 }).toString()+')('+JSON.stringify(url)+')');
 assert.equal(result.width,1);assert.equal(result.status,206);assert.equal(result.range,'bytes 0-7/'+bytes.length);
 assert.deepEqual(result.bytes,Array.from(bytes.subarray(0,8)));assert.equal(result.head,200);assert.equal(result.headSize,0);assert.equal(result.forbidden,404);
 window.destroy();
 const restored=new MediaFileAccess(directory);assert.equal(restored.resolve(url),fs.realpathSync(image));
 console.log('MEDIA_ELECTRON_PASS '+JSON.stringify({electron:process.versions.electron,...result}));
 app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
`,
  );
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [path.join(directory, 'main.cjs')], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 30000,
    env: environment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Media Electron probe failed: ' + result.status);
} finally {
  if (
    path.dirname(directory) !== os.tmpdir() ||
    !path.basename(directory).startsWith('soso-media-electron-')
  )
    throw new Error('Unexpected probe directory');
  fs.rmSync(directory, { recursive: true, force: true });
}
