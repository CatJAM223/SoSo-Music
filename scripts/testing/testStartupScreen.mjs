import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';
const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = path.join(root, 'scratch');
fs.mkdirSync(scratch, { recursive: true });
const directory = fs.mkdtempSync(path.join(scratch, 'startup-screen-'));
const require = createRequire(import.meta.url);
try {
  let html = fs
    .readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('/src/renderer/main.tsx', './entry.tsx');
  // This fixture uses real startup HTML/CSS, App and Suspense with a controlled lazy chunk.
  html = html.replace(/\s*<link[^>]+rel="(?:dns-prefetch|preconnect)"[^>]*>/g, '');
  fs.writeFileSync(path.join(directory, 'index.html'), html);
  fs.writeFileSync(
    path.join(directory, 'entry.tsx'),
    `
 import React from 'react';import{createRoot}from'react-dom/client';
 import{App}from'../../src/renderer/App.tsx';
 import{ErrorBoundary}from'../../src/shared/components/ErrorBoundary.tsx';
 import '../../src/renderer/index.css';
 window.mountStartup=()=>createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary name="Root" onError={()=>document.getElementById('app-preloader')?.remove()}><App/></ErrorBoundary></React.StrictMode>);
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
        name: 'delay-app-chunk',
        enforce: 'pre',
        transform(_code, id) {
          if (id.endsWith('/src/renderer/App.tsx')) {
            const from = "import('../desktop/ui/DesktopApp')";
            if (_code.split(from).length !== 2) throw Error('Expected one real app lazy import');
            return {
              code: _code.replace(
                from,
                "new Promise<void>(resolve=>{window.resolveStartup=resolve;}).then(()=>import('../desktop/ui/DesktopApp'))",
              ),
              map: null,
            };
          }
          if (id.endsWith('/src/desktop/ui/DesktopApp.tsx'))
            return {
              code: `import React from 'react';export function DesktopApp(){if(window.failStartup)throw Error('startup-fixture-error');return React.createElement('main',{'data-player-ready':true,style:{height:'100dvh',background:'var(--bg-app)'}},'Player ready');}`,
              map: null,
            };
        },
      },
    ],
    build: { outDir: path.join(directory, 'built'), target: 'esnext', minify: false },
  });
  const resultFile = path.join(scratch, 'startup-screen-result.json');
  const main = String.raw`const{app,BrowserWindow,session}=require('electron');const fs=require('node:fs'),path=require('node:path');
 app.setPath('userData',path.join(__dirname,'profile'));const deadline=setTimeout(()=>app.exit(1),45000);
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 app.whenReady().then(async()=>{
 let external=0;session.defaultSession.webRequest.onBeforeRequest((details,reply)=>{const ok=/^(file|blob|data|devtools):/.test(details.url);if(!ok)external++;reply({cancel:!ok});});
 const win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
 const evaluate=js=>win.webContents.executeJavaScript(js);
 const assert=(condition,message)=>{if(!condition)throw Error(message);};
 const rows=[];
 for(const [width,height,zoom,light,reduced,fail] of [[1200,800,1,false,false,false],[1440,900,1.25,true,false,false],[650,900,1,false,true,false],[1200,800,1,false,false,true]]){
 win.setSize(width,height);win.webContents.setZoomFactor(zoom);
 if(rows.length)await evaluate('localStorage.setItem("soso_theme",'+JSON.stringify(light?'light':'dark')+')');
 console.log('STARTUP_CASE '+rows.length);
 await win.loadFile(path.join(__dirname,'built/index.html'));
 if(!win.webContents.debugger.isAttached())win.webContents.debugger.attach('1.3');
 await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]});

 await evaluate('document.documentElement.dataset.theme='+JSON.stringify(light?'light':'dark')+';document.documentElement.classList.toggle("dark",'+(!light)+')');
 const initial=await evaluate("(() => {\n    const loader = document.getElementById('app-preloader'),\n      box = loader.getBoundingClientRect(),\n      logo = loader.querySelector('img').getBoundingClientRect();\n    window.initialLoader = loader;\n    window.initialRing = loader.querySelector('.startup-ring');\n    return {\n      w: innerWidth,\n      h: innerHeight,\n      box: { x: box.x, y: box.y, w: box.width, h: box.height },\n      logoX: logo.x + logo.width / 2,\n      logoY: logo.y + logo.height / 2,\n      background: getComputedStyle(loader).backgroundColor,\n      animations: loader.getAnimations({ subtree: true }).length,\n    };\n  })()");
 assert(initial.box.x===0 && initial.box.y===0 && Math.abs(initial.box.w-initial.w)<1 && Math.abs(initial.box.h-initial.h)<1,'Static loader must cover the entire viewport');
 assert(initial.background===(light?'rgb(241, 245, 249)':'rgb(18, 18, 18)'),'Startup background must match the theme');
 assert(Math.abs(initial.logoX-initial.w/2)<1 && Math.abs(initial.logoY-(initial.h/2-17))<2,'Static loader must remain centered');
 if(reduced)assert(initial.animations===0,'Reduced motion must disable startup animation');
 await evaluate('window.mountStartup()');
 await pause(180);
 const pending=await evaluate("(() => {\n    const loader = document.getElementById('app-preloader'),\n      fallback = document.querySelector('[data-fullscreen-loader]'),\n      box = fallback.getBoundingClientRect();\n    return {\n      same:\n        loader === window.initialLoader &&\n        loader.querySelector('.startup-ring') === window.initialRing,\n      opacity: getComputedStyle(loader).opacity,\n      ready: !!document.querySelector('[data-player-ready]'),\n      vw: innerWidth,\n      vh: innerHeight,\n      bootHeight: loader.getBoundingClientRect().height,\n      w: box.width,\n      h: box.height,\n      x: box.x,\n      y: box.y,\n    };\n  })()");
 assert(pending.same && pending.opacity==='1' && !pending.ready,'Lazy loading must preserve the original animation and opaque screen');
 assert(pending.x===0 && pending.y===0 && Math.abs(pending.w-pending.vw)<1 && Math.abs(pending.h-pending.vh)<1 && Math.abs(pending.bootHeight-pending.vh)<1,'React loading fallback must cover the entire viewport '+JSON.stringify({initial,pending}));
 if(rows.length===0){fs.writeFileSync(path.join(__dirname,'..','startup-screen-pending.png'),(await win.webContents.capturePage()).toPNG());}
 await evaluate('window.failStartup='+fail+';window.resolveStartup()');
 const readyDeadline=Date.now()+3000;
 while(!await evaluate('!!document.querySelector("[data-player-ready]") || document.body.innerText.includes("startup-fixture-error")')){
  if(Date.now()>readyDeadline)throw Error('Lazy app did not commit');await pause(10);
 }
 await pause(60);
 const fading=await evaluate('(()=>{const el=document.getElementById("app-preloader");return{exists:!!el,classes:el?.className,visibility:document.visibilityState,opacity:el?+getComputedStyle(el).opacity:0,ready:!!document.querySelector("[data-player-ready]")};})()');
 if(!reduced && !fail)assert(fading.exists && fading.ready && fading.opacity<1 && fading.opacity>0,'Startup must fade over the committed player '+JSON.stringify(fading));
 await pause(350);
 const done=await evaluate('({loader:!!document.getElementById("app-preloader"),ready:!!document.querySelector("[data-player-ready]"),error:document.body.innerText.includes("startup-fixture-error")})');
 assert(!done.loader && (fail?done.error:done.ready),'Startup screen must release the player or error UI');
 rows.push({width,height,zoom,light,reduced,fail,initial,pending,fading,done});
 }
 win.destroy();clearTimeout(deadline);fs.writeFileSync(RESULT_FILE,JSON.stringify({ok:true,externalRequests:external,rows},null,2));console.log('STARTUP_SCREEN_OK '+JSON.stringify({cases:rows.length,externalRequests:external}));app.exit(external?1:0);
 }).catch(error=>{clearTimeout(deadline);fs.writeFileSync(RESULT_FILE,JSON.stringify({ok:false,error:String(error),stack:error.stack},null,2));console.error(error);app.exit(1);});`;
  fs.writeFileSync(
    path.join(directory, 'main.cjs'),
    main.replaceAll('RESULT_FILE', JSON.stringify(resultFile)),
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
    !path.basename(directory).startsWith('startup-screen-')
  )
    throw Error('Unsafe fixture path');
  fs.rmSync(directory, { recursive: true, force: true });
}
