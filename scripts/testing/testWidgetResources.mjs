import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const production = process.argv.includes('--production');
const scratch = path.join(root, 'scratch');
fs.mkdirSync(scratch, { recursive: true });
const folder = fs.mkdtempSync(path.join(scratch, 'widget-resources-'));
try {
  const result = await build({
    entryPoints: [path.join(root, 'src/renderer/main.tsx')],
    outdir: folder,
    entryNames: 'entry',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    minify: true,
    metafile: true,
    loader: { '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.webp': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  fs.writeFileSync(path.join(folder, 'meta.json'), JSON.stringify(result.metafile));
  fs.writeFileSync(
    path.join(folder, 'index.html'),
    '<!doctype html><div id="app-preloader"></div><div id="root"></div><script type="module" src="entry.js"></script>',
  );
  fs.writeFileSync(
    path.join(folder, 'preload.cjs'),
    `
const {contextBridge,ipcRenderer}=require('electron');
localStorage.setItem('soso_accent_color','amber');
contextBridge.exposeInMainWorld('electronAPI',{
 onWidgetStateUpdate(callback){const listener=(_,state)=>callback(state);ipcRenderer.on('probe:state',listener);return()=>ipcRenderer.removeListener('probe:state',listener);},
 sendWidgetCommand(command,data){ipcRenderer.send('probe:command',{command,data});},
 toggleWidget(){ipcRenderer.send('probe:command',{command:'close'});return Promise.resolve(false);},
 setInterfaceLanguage(){return Promise.resolve();}
});`,
  );
  fs.writeFileSync(
    path.join(folder, 'main.cjs'),
    String.raw`
const {app,BrowserWindow,ipcMain,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fileURLToPath}=require('node:url');
const folder=process.argv[2],root=process.argv[3],production=process.argv[4]==='--production';
app.setPath('userData',path.join(folder,'profile'));
app.on('window-all-closed',()=>{});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<100;i++){if(await fn())return;await delay(30);}throw Error('Timeout: '+label);}
app.whenReady().then(async()=>{
 const meta=JSON.parse(fs.readFileSync(path.join(folder,'meta.json'))),loaded=new Set(),commands=[],external=[];
 const state={track:{id:'fixture',title:'Fixture Song',artist:{name:'Fixture Artist'},album:{}},isPlaying:true,currentTime:12,duration:180,isLiked:false,volume:.6};
 session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
  const url=new URL(details.url);
  if(['http:','https:'].includes(url.protocol)){external.push(url.origin+url.pathname);callback({cancel:true});return;}
  if(url.protocol==='file:'&&url.pathname.endsWith('.js'))loaded.add(fileURLToPath(url));
  assert.ok(!url.pathname.endsWith('.wasm'),'widget must not initialize the recommendation engine');
  callback({});
 });
 ipcMain.on('probe:command',(event,payload)=>{
  commands.push(payload);
  if(payload.command==='requestState')event.sender.send('probe:state',state);
 });
 for(let pass=0;pass<3;pass++){
  const win=new BrowserWindow({show:false,width:340,height:140,webPreferences:{preload:path.join(folder,'preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  await win.loadFile(production?path.join(root,'dist/index.html'):path.join(folder,'index.html'),{hash:'/widget'});
  await until(()=>win.webContents.executeJavaScript("document.querySelector('h3')?.textContent==='Fixture Song'"),'light widget boot');
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('app-preloader')===null"),true);
  await until(()=>win.webContents.executeJavaScript("document.documentElement.getAttribute('data-accent')==='amber'"),'saved widget accent');
  if(pass===0){
   await win.webContents.executeJavaScript("for(const title of ['Предыдущий трек','Следующий трек','Добавить в любимые'])document.querySelector('button[title=\"'+title+'\"]').click();document.querySelector('svg.lucide-pause').closest('button').click();");
   await win.webContents.executeJavaScript("const bar=document.querySelector('[class*=\"group/bar\"]');bar.style.width='200px';bar.style.height='10px';const rect=bar.getBoundingClientRect();bar.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+rect.width/2}));document.querySelector('#root>div').dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-1}));");
   await until(()=>commands.some(item=>item.command==='setVolume'),'widget commands');
   for(const command of ['prev','next','toggleLike','togglePlay'])assert.ok(commands.some(item=>item.command===command),command);
   assert.ok(commands.some(item=>item.command==='seek'&&Math.abs(item.data-90)<1));
   assert.ok(commands.some(item=>item.command==='setVolume'&&Math.abs(item.data-.65)<.001));
   win.webContents.send('probe:state',{...state,isPlaying:false,currentTime:40,isLiked:true});
   await until(()=>win.webContents.executeJavaScript("!!document.querySelector('svg.lucide-play')"),'paused state');
   assert.ok(await win.webContents.executeJavaScript("!!document.querySelector('svg.lucide-heart.fill-current')"));
   await win.webContents.executeJavaScript("document.querySelector('button[title=\"Закрыть виджет\"]').click()");
   await until(()=>commands.some(item=>item.command==='close'),'close command');
  }
  win.destroy();
 }
 const outputs=new Map(Object.entries(meta.outputs).map(([file,data])=>[path.resolve(root,file),data]));
 const inputs=new Set();let bytes=0;
 for(const file of loaded){
  if(production){
   assert.ok(file.startsWith(path.join(root,'dist')+path.sep),'JavaScript outside production build');
   assert.ok(!/mountPlayer|DesktopApp|vendor-hls/.test(path.basename(file)),'main player chunk loaded');
   assert.ok(!fs.readFileSync(file,'utf8').includes('[Wave:Refresh]'),'recommendation engine loaded');
   bytes+=fs.statSync(file).size;continue;
  }
  const output=outputs.get(file);assert.ok(output,'unknown JavaScript '+file);bytes+=fs.statSync(file).size;for(const input of Object.keys(output.inputs))inputs.add(input);}
 const forbidden=[...inputs].filter(input=>/AudioContext|useAudioPlayerCore|mountPlayer|DesktopApp|waveSongMatrix|hls\.js/.test(input));
 assert.deepEqual(forbidden,[],'auxiliary widget must never load the main player');
 if(!production)assert.ok([...inputs].some(input=>input.endsWith('DesktopWidget.tsx')));
 assert.deepEqual(external,[]);
 const report={ok:true,production,openCloseCycles:3,loadedJavaScriptBytes:bytes,loadedChunks:loaded.size,mainPlayerModules:forbidden.length,externalRequests:external.length,controls:['prev','next','togglePlay','toggleLike','seek','setVolume','close']};
 fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(report,null,2));console.log('WIDGET_RESOURCES_OK '+JSON.stringify(report));app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const probe = spawnSync(
    require('electron'),
    [path.join(folder, 'main.cjs'), folder, root, ...(production ? ['--production'] : [])],
    {
      cwd: root,
      env,
      windowsHide: true,
      stdio: 'inherit',
      timeout: 30000,
    },
  );
  if (probe.error) throw probe.error;
  if (probe.status !== 0) throw Error('Widget resource regression: ' + probe.status);
  fs.copyFileSync(
    path.join(folder, 'result.json'),
    path.join(
      scratch,
      production ? 'widget-production-resource-result.json' : 'widget-resource-result.json',
    ),
  );
} finally {
  if (path.dirname(folder) !== scratch || !path.basename(folder).startsWith('widget-resources-'))
    throw Error('Unexpected fixture directory');
  fs.rmSync(folder, { recursive: true, force: true });
}
