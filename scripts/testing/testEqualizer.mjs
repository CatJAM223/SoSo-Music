import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import esbuild from 'esbuild';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  require = createRequire(import.meta.url);
const directory = path.join(root, 'scratch/equalizer-electron');
fs.mkdirSync(directory, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'scripts/testing/equalizerRenderer.tsx')],
  outdir: directory,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  logLevel: 'silent',
});
fs.writeFileSync(
  path.join(directory, 'index.html'),
  '<!doctype html><html class="dark"><meta charset="utf-8"><link rel="stylesheet" href="equalizerRenderer.css"><body style="margin:0;background:#141619;font-family:system-ui"><div id="root"></div><script src="equalizerRenderer.js"></script></body></html>',
);
const main = `const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const directory=${JSON.stringify(directory)};
app.setPath('userData',path.join(directory,'profile-'+process.pid));
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const deadline=setTimeout(()=>{console.error('Equalizer test timeout');app.exit(1)},45000);
app.whenReady().then(async()=>{
 const window=new BrowserWindow({width:1060,height:780,show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true}});
 window.webContents.setAudioMuted(true);
 await window.loadFile(path.join(directory,'index.html'));
 window.webContents.debugger.attach('1.3');
 await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 const result=await window.webContents.executeJavaScript('globalThis.runEqualizerChecks()');
 if(result.ok){
  const slider=await window.webContents.executeJavaScript('(()=>{const svg=document.querySelector(".equalizer-graph"),p=svg.createSVGPoint(),c=document.querySelectorAll("[role=slider]")[4];p.x=Number(c.getAttribute("cx"));p.y=Number(c.getAttribute("cy"));const q=p.matrixTransform(svg.getScreenCTM());return {x:Math.round(q.x),y:Math.round(q.y)};})()');
  window.webContents.sendInputEvent({type:'mouseMove',...slider});
  window.webContents.sendInputEvent({type:'mouseDown',...slider,button:'left',clickCount:1});
  window.webContents.sendInputEvent({type:'mouseMove',x:slider.x,y:slider.y-30,button:'left'});
  window.webContents.sendInputEvent({type:'mouseUp',x:slider.x,y:slider.y-30,button:'left',clickCount:1});
  await new Promise(resolve=>setTimeout(resolve,120));
  const gain=await window.webContents.executeJavaScript('Number(document.querySelectorAll("[role=slider]")[4].getAttribute("aria-valuenow"))');
  if(gain<=-1){result.ok=false;result.error='Real pointer drag failed';}else result.results.push({pointerDragGain:gain});
  await window.webContents.executeJavaScript('document.querySelector(".equalizer-precise input").focus();document.querySelector(".equalizer-precise input").select()');
  await window.webContents.insertText('-');await new Promise(resolve=>setTimeout(resolve,30));
  await window.webContents.insertText('6');await new Promise(resolve=>setTimeout(resolve,60));
  const precise=await window.webContents.executeJavaScript('Number(document.querySelectorAll("[role=slider]")[4].getAttribute("aria-valuenow"))');
  if(precise!==-6){result.ok=false;result.error='Negative gain keyboard entry failed: '+precise;}else result.results.push({preciseGain:precise});
  await window.webContents.executeJavaScript('document.querySelector(".equalizer-precise input").blur()');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await window.webContents.executeJavaScript('document.querySelectorAll(".equalizer-presets button")[0].click()');
  await new Promise(resolve=>setTimeout(resolve,60));
  const reducedMotionY=await window.webContents.executeJavaScript('Number(document.querySelector(".equalizer-handle").getAttribute("cy"))');
  if(Math.abs(reducedMotionY-118)>0.1){result.ok=false;result.error='Reduced motion should snap to neutral';}else result.results.push({reducedMotion:'respected'});
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  window.webContents.debugger.detach();
  await window.webContents.capturePage();await new Promise(resolve=>setTimeout(resolve,200));
  const image=await window.webContents.capturePage();fs.writeFileSync(path.join(directory,'preview.png'),image.toPNG());
 }
 console.log(JSON.stringify(result));fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));clearTimeout(deadline);window.destroy();app.exit(result.ok?0:1);
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1)});`;
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
  child.once('error', reject);
  child.once('exit', resolve);
});
process.exitCode = code ?? 1;
