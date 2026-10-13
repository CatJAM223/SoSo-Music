import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(root, 'scratch/audio-transitions-electron');
fs.mkdirSync(directory, { recursive: true });
const renderer = await esbuild.build({
  stdin: {
    contents: fs.readFileSync(new URL('./audioTransitionRenderer.ts', import.meta.url), 'utf8'),
    resolveDir: path.join(root, 'scripts/testing'),
    loader: 'ts',
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  logLevel: 'silent',
});
const main = `const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const directory=${JSON.stringify(directory)};
app.setPath('userData',path.join(directory,'profile-'+process.pid));
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.on('window-all-closed',()=>{});
const deadline=setTimeout(()=>{fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({ok:false,error:'test-timeout'}));app.exit(1);},45000);
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 window.webContents.setAudioMuted(true);
 await window.loadURL('data:text/html,<title>SoSo audio integration</title>');
 const result=await window.webContents.executeJavaScript(${JSON.stringify(renderer.outputFiles[0].text + '\nglobalThis.audioTransitionsResult;')});
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));clearTimeout(deadline);window.destroy();app.exit(result.ok?0:1);
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1);});`;
const target = path.join(directory, 'main.cjs');
fs.writeFileSync(target, main);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const code = await new Promise((resolve, reject) => {
  const child = spawn(require('electron'), [target], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: 'inherit',
  });
  child.on('error', reject);
  child.on('exit', resolve);
});
process.exitCode = code ?? 1;
