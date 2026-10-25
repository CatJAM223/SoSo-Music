import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'vite';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
export async function runAudioBrowserFixture(name, rendererModule, runner) {
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratch, name + '-'));
  const resultFile = path.join(scratch, name + '-result.json');
  const csp = fs
    .readFileSync(path.join(root, 'index.html'), 'utf8')
    .match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
  try {
    if (!csp) throw Error('Missing production CSP');
    fs.writeFileSync(
      path.join(directory, 'index.html'),
      `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><script type="module" src="./entry.ts"></script>`,
    );
    fs.writeFileSync(
      path.join(directory, 'entry.ts'),
      `
    import {initializeRustCompute} from '../../src/shared/compute/rustCore.ts';
    import {${runner}} from '../../scripts/testing/${rendererModule}';
    window.audioFixtureResult=(async()=>{
      if(!await initializeRustCompute(await (await fetch(new URL('compute/soso-core.wasm',document.baseURI))).arrayBuffer())) throw Error('Rust initialization failed');
      return await ${runner}();
    })().catch(error=>({ok:false,error:String(error),stack:error.stack}));
  `,
    );
    await build({
      configFile: false,
      root: directory,
      base: './',
      logLevel: 'warn',
      build: { outDir: path.join(directory, 'built'), minify: false },
    });
    fs.cpSync(path.join(root, 'public/compute'), path.join(directory, 'built/compute'), {
      recursive: true,
    });
    const main = `const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const deadline=setTimeout(()=>app.exit(1),60000);
app.whenReady().then(async()=>{
 let external=0;
 session.defaultSession.webRequest.onBeforeRequest((details,reply)=>{const ok=/^(file|blob|data|devtools):/.test(details.url);if(!ok)external++;reply({cancel:!ok});});
 const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 window.webContents.setAudioMuted(true);
 await window.loadFile(path.join(__dirname,'built/index.html'));
 const result=await window.webContents.executeJavaScript('window.audioFixtureResult');
 fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({...result,externalRequests:external,electron:process.versions.electron,chromium:process.versions.chrome},null,2));
 console.log(JSON.stringify(result));clearTimeout(deadline);window.destroy();app.exit(result?.ok && external===0?0:1);
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1);});`;
    const target = path.join(directory, 'main.cjs');
    fs.writeFileSync(target, main);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    process.exitCode = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [target], {
        cwd: root,
        env,
        windowsHide: true,
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    if (path.dirname(directory) !== scratch || !path.basename(directory).startsWith(name + '-'))
      throw Error('Unsafe fixture path');
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
