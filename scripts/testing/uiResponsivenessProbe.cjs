// Hidden Electron fixture: render/commit and DOM-update timings, not presented-frame latency.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const output = process.argv[2],
  report = process.argv[3];
app.setPath('userData', path.join(output, 'profile'));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const rendererErrors = [];
let win;
const timeout = setTimeout(() => {
  console.error('UI responsiveness probe timed out');
  app.exit(1);
}, 80000);
const evaluate = (source) => win.webContents.executeJavaScript(source, true);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stats = (values) => {
  if (!values.length) return { count: 0, medianMs: null, p95Ms: null, maxMs: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    maxMs: sorted.at(-1),
  };
};
app
  .whenReady()
  .then(async () => {
    let externalRequests = 0;
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = /^(file|data|blob):/.test(details.url);
      if (!allowed) externalRequests++;
      callback({ cancel: !allowed });
    });
    win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3) {
        rendererErrors.push(message);
        console.error('RENDERER', message);
      }
    });
    win.webContents.debugger.attach('1.3');
    await win.loadFile(path.join(output, 'index.html'));
    const results = [];
    for (const artwork of [false, true])
      for (const throttle of [1, 4])
        for (const count of [300, 1000]) {
          await win.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate', {
            rate: throttle,
          });
          await evaluate(`mountUi(${count},${artwork})`);
          await pause(180);
          await evaluate('switchUiTrack(0)');
          await pause(100);
          const observed = await evaluate('uiProbe.renders');
          assert.ok(
            observed.TrackTable > 0 && observed.TrackRow > 0,
            'Profiling counters must observe real table and row renders before measuring their absence',
          );
          const measure = async (kind, samples) => {
            await evaluate(
              'uiProbe.renders={};uiProbe.commits=[];uiProbe.renderPasses=[];uiProbe.profiles=[];uiProbe.persistence=[];uiProbe.syncCommands=[];uiProbe.passiveEffects=[];uiProbe.dispatches=[]',
            );
            const latencies = [];
            for (let i = 0; i < samples; i++) {
              const trackIndex = kind === 'row-click' ? 3 + (i % 5) : 1 + (i % 10);
              const action =
                kind === 'progress'
                  ? `tickUiClock(${1 + i * 0.25})`
                  : kind === 'row-click'
                    ? `document.querySelector('[data-track-id="sc_${100000 + trackIndex}"]').click()`
                    : `switchUiTrack(${trackIndex})`;
              const target =
                kind === 'progress' ? (1 + i * 0.25).toFixed(3) : 'sc_' + (100000 + trackIndex);
              const element = kind === 'progress' ? 'clock' : 'current-track';
              const result = await evaluate(
                `new Promise((resolve,reject)=>{const element=document.getElementById(${JSON.stringify(element)}),target=${JSON.stringify(target)},started=performance.now();let observer,timer;const check=()=>{if(element.textContent===target){observer.disconnect();clearTimeout(timer);resolve(performance.now()-started);}};observer=new MutationObserver(check);observer.observe(element,{characterData:true,childList:true,subtree:true});timer=setTimeout(()=>{observer.disconnect();reject(Error('UI failed to commit '+target));},3000);try{${action};uiProbe.dispatches.push(performance.now()-started);check();}catch(error){observer.disconnect();clearTimeout(timer);reject(error);}})`,
              );

              latencies.push(result);
              await pause(25);
            }
            await pause(40);
            const metrics = await evaluate(
              '({renders:uiProbe.renders,commits:uiProbe.commits,renderPasses:uiProbe.renderPasses,profiles:uiProbe.profiles,persistence:uiProbe.persistence,syncCommands:uiProbe.syncCommands,dispatches:uiProbe.dispatches,passiveEffects:uiProbe.passiveEffects,domRows:document.querySelectorAll("[draggable]").length})',
            );
            return {
              kind,
              samples,
              renders: metrics.renders,
              domRows: metrics.domRows,
              reactCommit: stats(metrics.commits),
              reactRenderPass: stats(metrics.renderPasses),
              trackTableRender: stats(metrics.profiles.map((value) => value.actualDuration)),
              actionToDom: stats(latencies),
              syncCommand: stats(metrics.syncCommands),
              syncDispatch: stats(metrics.dispatches),
              persistence: stats(metrics.persistence.map((value) => value.duration)),
              passiveEffects: stats(metrics.passiveEffects),
            };
          };
          results.push({
            artwork: artwork ? 'stable-local' : 'missing',
            tracks: count,
            cpuThrottle: throttle,
            viewport: [1200, 800],
            progress: await measure('progress', 24),
            trackSwitch: await measure('track-switch', 12),
            rowClick: await measure('row-click', 8),
          });
        }
    // Preserve diagnostics even when a rendering contract fails.
    fs.writeFileSync(report, JSON.stringify({ results, externalRequests }, null, 2));
    // Timing distributions are diagnostics; deterministic rendering contracts are gates.
    for (const result of results) {
      const label =
        result.artwork + ' ' + result.tracks + ' tracks, CPU ' + result.cpuThrottle + 'x';
      assert.ok(
        result.rowClick.renders.TrackRow > 0,
        label + ': positive row-render control is missing',
      );
      assert.equal(
        result.progress.renders.TrackRow || 0,
        0,
        label + ': progress must not rerender track rows',
      );
      assert.equal(
        result.progress.renders.TrackTable || 0,
        0,
        label + ': progress must not rerender the table',
      );
      for (const model of ['LibraryModelProbe', 'ArtistModelProbe']) {
        assert.equal(
          result.progress.renders[model] || 0,
          0,
          label + ': progress rerendered ' + model,
        );
      }
      for (const measurement of [result.progress, result.trackSwitch, result.rowClick]) {
        assert.ok(
          measurement.domRows > 0 && measurement.domRows <= 40,
          label + ': virtualized DOM must stay bounded',
        );
        assert.equal(
          measurement.actionToDom.count,
          measurement.samples,
          label + ': missing committed actions',
        );
        assert.ok(Number.isFinite(measurement.actionToDom.p95Ms), label + ': invalid DOM timing');
      }
    }
    assert.deepEqual(rendererErrors, [], 'Performance fixture must not hide renderer errors');
    if (externalRequests) throw Error('Unexpected external requests: ' + externalRequests);
    const data = {
      at: new Date().toISOString(),
      runtime: process.versions,
      method: {
        legacyArtworkValidation: await evaluate('uiLegacyArtworkValidation'),
        domTiming: 'MutationObserver registered before dispatch; no timer polling',
        renderer: 'React 18 production profiling build',
        profiling:
          'injectProfilingHooks commit start/stop, component render counters, React Profiler actualDuration',
        transport:
          'EventTarget fixture audio; real useAudioPlayerCore, AudioProvider, context hooks, TrackTable and TrackRow',
        profile: 'isolated temporary Electron userData',
        externalRequests,
        artwork: 'missing fields and fully populated stable file URLs; no network artwork',
        screen: 'hidden BrowserWindow, backgroundThrottling=false; no frame-presentation claims',
      },
      results,
    };
    fs.writeFileSync(report, JSON.stringify(data, null, 2));
    console.log(
      'UI_RESPONSIVENESS_OK',
      JSON.stringify({ cases: results.length, externalRequests, report }),
    );
    clearTimeout(timeout);
    win.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  });
