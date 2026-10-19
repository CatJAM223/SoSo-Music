const electron = require('electron');
const { app, BrowserWindow, session } = electron;
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const [directory, root, phase, mainEntry = 'main.cjs'] = process.argv.slice(2);
const profile = path.join(directory, 'profile');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(
  path.join(profile, 'desktop-controls.json'),
  JSON.stringify({ overlayEnabled: false }),
);
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.setPath('crashDumps', path.join(profile, 'Crashpad'));
app.getAppPath = () => root;
const windows = [];
let pickerCalls = 0;
const videoPath = path.join(directory, 'selected wallpaper.webm');
class HiddenWindow extends BrowserWindow {
  constructor(options) {
    super({ ...options, show: false });
    windows.push({ window: this, title: options.title });
  }
  show() {}
  showInactive() {}
  focus() {}
}
class SilentTray extends EventEmitter {
  setToolTip() {}
  setContextMenu() {}
  destroy() {}
}
globalThis.__desktopProbeElectron = {
  ...electron,
  BrowserWindow: HiddenWindow,
  Tray: SilentTray,
  globalShortcut: { register: () => true, unregister() {}, unregisterAll() {} },
  dialog: {
    ...electron.dialog,
    async showOpenDialog() {
      pickerCalls++;
      return { canceled: false, filePaths: [videoPath] };
    },
    showErrorBox(title, message) {
      throw Error(title + ': ' + message);
    },
  },
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, budget = 7000) {
  const deadline = Date.now() + budget;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(25);
  }
  throw Error('Timed out: ' + label);
}
const deadline = setTimeout(() => {
  console.error('Desktop bootstrap timed out');
  app.exit(1);
}, 35000);
function fail(error) {
  console.error(error);
  clearTimeout(deadline);
  app.exit(1);
}
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);
function library(port, code) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/library',
        headers: code ? { Authorization: 'Bearer ' + code } : {},
        timeout: 1500,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode, body }));
      },
    );
    request.on('timeout', () => request.destroy(Error('LAN request timed out')));
    request.on('error', reject);
  });
}
async function click(window, action) {
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-probe="result"]').textContent='pending';document.querySelector('[data-probe="${action}"]').click()`,
  );
  const text = await until(async () => {
    const value = await window.webContents.executeJavaScript(
      'document.querySelector(\'[data-probe="result"]\').textContent',
    );
    return value !== 'pending' && value !== 'ready' ? value : null;
  }, action + ' result');
  const result = JSON.parse(text);
  assert.ok(!result.error, text);
  return result;
}
async function checkVideo(window, label) {
  await until(
    () =>
      window.webContents.executeJavaScript(
        "!!document.querySelector('video') && document.querySelector('video').readyState >= 2",
      ),
    label + ' decoded video',
  );
  const before = await window.webContents.executeJavaScript(
    "document.querySelector('video').currentTime",
  );
  await until(
    () =>
      window.webContents.executeJavaScript(
        'document.querySelector("video").currentTime > ' + (before + 0.12),
      ),
    label + ' advancing video',
  );
}
app
  .whenReady()
  .then(async () => {
    // Network transports are the boundary: no remote service is contacted by this probe.
    for (const scheme of ['http', 'https'])
      await session.defaultSession.protocol.handle(scheme, (request) =>
        request.url.endsWith('/csp-probe.js')
          ? new Response('window.auditRemoteRan=true', {
              headers: { 'Content-Type': 'text/javascript' },
            })
          : new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }),
      );
    globalThis.fetch = async () => new Response('{}', { status: 503 });
    if (phase === 'initial') {
      const recorderWindow = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
      });
      await recorderWindow.loadURL('data:text/html,<title>Local video fixture</title>');
      const bytes = await recorderWindow.webContents.executeJavaScript(`(async()=>{
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
      const context=canvas.getContext('2d');let frame=0;
      const draw=()=>{context.fillStyle=frame++%2?'#20c070':'#2060c0';context.fillRect(0,0,160,90);};draw();
      const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
      recorder.ondataavailable=event=>chunks.push(event.data);
      const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
      const timer=setInterval(draw,70);await new Promise(resolve=>setTimeout(resolve,2600));recorder.stop();await done;
      clearInterval(timer);stream.getTracks().forEach(track=>track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    })()`);
      fs.writeFileSync(videoPath, Buffer.from(bytes));
      recorderWindow.destroy();
    }
    const main = await until(
      () => windows.find((item) => item.title === 'SoSo Music')?.window,
      'production main window',
    );
    await until(
      () =>
        main.webContents.executeJavaScript(
          '!!document.querySelector(\'[data-probe="select"]\') && !!window.electronAPI?.startLanSync',
        ),
      'production preload and renderer',
    );
    assert.equal(
      electron.crashReporter.getUploadToServer(),
      false,
      'Crash reports must stay local',
    );
    if (phase === 'main-crash') {
      console.log('EXPECTED_MAIN_CRASH');
      process.crash();
      throw Error('Native main crash returned');
    }
    if (phase === 'renderer-crash') {
      const pid = main.webContents.getOSProcessId();
      const loaded = new Promise((resolve) => main.webContents.once('did-finish-load', resolve));
      main.webContents.forcefullyCrashRenderer();
      await loaded;
      assert.notEqual(main.webContents.getOSProcessId(), pid, 'Renderer process must be replaced');
      assert.equal(main.isDestroyed(), false, 'Main window must survive a native renderer crash');
      await until(
        () => main.webContents.executeJavaScript('!!window.electronAPI?.startLanSync'),
        'preload after crash',
      );
      const log = fs.readFileSync(path.join(profile, 'logs/playback.log'), 'utf8');
      assert.ok(log.includes('Renderer process gone') && log.includes('Recovering main renderer'));
    }
    main.webContents.send('ui:animationsPaused', false);
    if (phase === 'initial') {
      await main.webContents.executeJavaScript(
        "window.electronAPI.createPlaylist('Bootstrap fixture')",
      );
      const started = await click(main, 'start');
      assert.equal(started.active, true, 'Production sync:start IPC must start its server');
      assert.ok(started.port > 0 && /^\d{8}$/.test(started.code));
      assert.equal((await library(started.port)).status, 401);
      const exported = await library(started.port, started.code);
      assert.equal(exported.status, 200);
      assert.equal(JSON.parse(exported.body).app, 'SoSo Music');
      assert.equal((await click(main, 'stop')).active, false);
      await assert.rejects(library(started.port, started.code));
      const selected = await click(main, 'select');
      assert.ok(selected.filePath.startsWith('media://local/'));
      assert.equal(pickerCalls, 1);
      fs.writeFileSync(path.join(directory, 'expected-url.txt'), selected.filePath);
    } else assert.equal(pickerCalls, 0);
    await checkVideo(main, phase);
    const url = fs.readFileSync(path.join(directory, 'expected-url.txt'), 'utf8');
    assert.equal(
      await main.webContents.executeJavaScript("localStorage.getItem('soso_wallpaper_path')"),
      url,
    );
    const transfer = await main.webContents.executeJavaScript(`(async()=>{
    const response=await fetch(${JSON.stringify(url)},{headers:{Range:'bytes=0-7'}});
    const head=await fetch(${JSON.stringify(url)},{method:'HEAD'});
    const denied=await fetch('media://local/?path='+encodeURIComponent(${JSON.stringify(videoPath)}));
    return {status:response.status,bytes:(await response.arrayBuffer()).byteLength,head:head.status,denied:denied.status};
  })()`);
    assert.deepEqual(transfer, { status: 206, bytes: 8, head: 200, denied: 404 });
    await main.webContents.executeJavaScript(
      "(()=>{const video=document.querySelector('video');video.loop=false;video.currentTime=1.2;})()",
    );
    await until(
      () =>
        main.webContents.executeJavaScript(
          "!document.querySelector('video').seeking && document.querySelector('video').currentTime >= 1.15",
        ),
      'wallpaper seek',
    );
    main.webContents.send('ui:animationsPaused', true);
    await until(
      () => main.webContents.executeJavaScript("!document.querySelector('video')"),
      'wallpaper released on pause',
    );
    main.webContents.send('ui:animationsPaused', false);
    await checkVideo(main, 'restored');
    const foreign = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(directory, 'dist-electron/preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await foreign.loadFile(path.join(directory, 'dist/index.html'));
    for (const method of ['startLanSync', 'selectWallpaperVideo']) {
      const rejected = await foreign.webContents.executeJavaScript(
        `window.electronAPI.${method}().then(()=>false,()=>true)`,
      );
      assert.equal(rejected, true, 'Foreign window must not invoke ' + method);
    }
    assert.equal(pickerCalls, phase === 'initial' ? 1 : 0);
    foreign.destroy();
    const policy = await main.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
    const violations=[];let remoteSettled=false;
    const timer=setTimeout(()=>reject(Error('CSP probe did not settle')),2500);
    const finish=()=>{
      if(!remoteSettled||(!window.auditInlineRan&&!violations.some(event=>event.blocked==='inline'))||
         (!window.auditRemoteRan&&!violations.some(event=>event.blocked.startsWith('https://blocked.invalid'))))return;
      clearTimeout(timer);resolve({inline:!!window.auditInlineRan,remote:!!window.auditRemoteRan,violations});
    };
    document.addEventListener('securitypolicyviolation',event=>{violations.push({directive:event.effectiveDirective,blocked:event.blockedURI});finish();});
    const inline=document.createElement('script');inline.textContent='window.auditInlineRan=true';document.body.append(inline);
    const remote=document.createElement('script');remote.onload=remote.onerror=()=>{remoteSettled=true;finish();};
    remote.src='https://blocked.invalid/csp-probe.js';document.body.append(remote);
  })`);
    assert.equal(policy.inline, false, 'Inline script must be blocked by application CSP');
    assert.equal(policy.remote, false, 'Remote script must be blocked by application CSP');
    assert.ok(policy.violations.some((event) => event.blocked === 'inline'));
    assert.ok(
      policy.violations.some((event) => event.blocked.startsWith('https://blocked.invalid')),
    );
    console.log(
      'DESKTOP_BOOTSTRAP_OK ' +
        JSON.stringify({
          phase,
          realMain: true,
          realPreload: true,
          sync: true,
          videoDecoded: true,
          seek: true,
          restartPermission: phase === 'restart',
          foreignWindowRejected: true,
          cspBlockedScripts: true,
          rendererRecovered: phase === 'renderer-crash',
        }),
    );
    clearTimeout(deadline);
    for (const item of BrowserWindow.getAllWindows()) item.destroy();
    app.quit();
  })
  .catch(fail);
// Intercept only Electron's OS-facing object for the already-built main/chunks.
// Its actual IPC/protocol registration, services and preload are unchanged.
const Module = require('node:module');
const load = Module._load;
Module._load = function (request, parent, ...args) {
  if (
    request === 'electron' &&
    parent?.filename.startsWith(path.join(directory, 'dist-electron') + path.sep)
  )
    return globalThis.__desktopProbeElectron;
  return load.call(this, request, parent, ...args);
};
require(path.join(directory, 'dist-electron', mainEntry));
