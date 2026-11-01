import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = path.join(root, 'scratch');
fs.mkdirSync(scratch, { recursive: true });
const directory = fs.mkdtempSync(path.join(scratch, 'compute-startup-'));
const require = createRequire(import.meta.url);
try {
  let html = fs
    .readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('/src/renderer/main.tsx', './entry.tsx')
    .replace(/\s*<link[^>]+rel="(?:dns-prefetch|preconnect)"[^>]*>/g, '');
  fs.writeFileSync(path.join(directory, 'index.html'), html);
  fs.writeFileSync(
    path.join(directory, 'entry.tsx'),
    `
    import {mountPlayer} from '../../src/renderer/mountPlayer.tsx';
    import '../../src/renderer/index.css';
    const originalFetch=window.fetch.bind(window);
    window.startCompute=()=>{
      window.fetch=(url,options)=>window.computeMode==='broken'
        ? Promise.resolve(new Response(new Uint8Array([0,1,2])))
        : window.computeMode==='missing'
          ? Promise.resolve(new Response('',{status:404}))
          : originalFetch(url,options);
      mountPlayer(document.getElementById('root'));
    };
  `,
  );
  await build({
    configFile: false,
    root: directory,
    publicDir: path.join(root, 'public'),
    base: './',
    logLevel: 'warn',
    plugins: [
      {
        name: 'isolate-startup-from-playback',
        enforce: 'pre',
        transform(_code, id) {
          if (id.endsWith('/src/shared/context/AudioContext.tsx'))
            return {
              code: 'export function AudioProvider({children}){return children;}',
              map: null,
            };
          if (id.endsWith('/src/renderer/App.tsx'))
            return {
              code: `import React,{useEffect}from'react';export function App(){useEffect(()=>{document.getElementById('app-preloader')?.remove()},[]);return React.createElement('main',{'data-player-ready':true},'Player ready');}`,
              map: null,
            };
        },
      },
    ],
    build: { outDir: path.join(directory, 'built'), minify: false, target: 'esnext' },
  });
  const resultFile = path.join(scratch, 'compute-startup-result.json');
  fs.writeFileSync(
    path.join(directory, 'main.cjs'),
    `
    const {app,BrowserWindow,session}=require('electron');
    const fs=require('node:fs'),path=require('node:path');
    app.setPath('userData',path.join(__dirname,'profile'));
    const deadline=setTimeout(()=>app.exit(1),45000);
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    app.whenReady().then(async()=>{
      let external=0;
      session.defaultSession.webRequest.onBeforeRequest((details,reply)=>{
        const ok=/^(file|blob|data|devtools):/.test(details.url);if(!ok)external++;
        reply({cancel:!ok});
      });
      const win=new BrowserWindow({show:false,width:650,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
      const evaluate=js=>win.webContents.executeJavaScript(js);
      const assert=(ok,message)=>{if(!ok)throw Error(message)};
      const waitFor=async(js)=>{const end=Date.now()+5000;while(!await evaluate(js)){if(Date.now()>end)throw Error('Startup condition timed out: '+js);await pause(20)}};
      const rows=[];
      for(const [mode,language] of [['broken','ru'],['missing','en']]){
        await win.loadFile(path.join(__dirname,'built/index.html'));
        await evaluate('localStorage.setItem("soso_language",'+JSON.stringify(language)+');localStorage.setItem("soso_startup_preserve","saved")');
        await win.loadFile(path.join(__dirname,'built/index.html'));
        await waitFor('typeof window.startCompute==="function"');
        await evaluate('window.computeMode='+JSON.stringify(mode)+';window.startCompute()');
        await waitFor('!!document.querySelector("[role=alert]")');
        const failure=await evaluate('({text:document.body.innerText,loader:!!document.getElementById("app-preloader"),buttons:[...document.querySelectorAll("button")].map(el=>({text:el.textContent,disabled:el.disabled})),focused:document.activeElement?.textContent,overflow:document.documentElement.scrollWidth>innerWidth})');
        assert(!failure.loader && failure.buttons.length===2 && !failure.buttons[0].disabled,'Recovery actions must be available');
        assert(failure.focused===failure.buttons[0].text && !failure.overflow,'Recovery must support keyboard and narrow windows');
        assert(failure.text.includes(language==='ru'?'Не удалось подготовить плеер':'Could not prepare the player'),'Recovery must use the saved language');
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(__dirname,'..','compute-startup-'+language+'.png'),(await win.webContents.capturePage()).toPNG());
        await evaluate('window.computeMode="ready";document.querySelector("button").click();document.querySelector("button").click()');
        await waitFor('!!document.querySelector("[data-player-ready]")');
        assert(await evaluate('localStorage.getItem("soso_startup_preserve")==="saved"'),'Retry must preserve data');
        assert(!await evaluate('!!document.querySelector("[role=alert]")'),'Successful retry must release recovery UI');
        rows.push({mode,language,failure,retried:true});
      }
      fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({ok:true,externalRequests:external,rows},null,2));
      win.destroy();clearTimeout(deadline);console.log('COMPUTE_STARTUP_OK '+JSON.stringify({cases:rows.length,externalRequests:external}));app.exit(external?1:0);
    }).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1)});
  `,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [path.join(directory, 'main.cjs')], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: 'inherit',
    timeout: 50000,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (
    path.dirname(directory) !== scratch ||
    !path.basename(directory).startsWith('compute-startup-')
  )
    throw Error('Unsafe fixture path');
  fs.rmSync(directory, { recursive: true, force: true });
}
