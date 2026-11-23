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
const until = async (source, label) => {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (await evaluate(source)) return;
    await pause(20);
  }
  throw Error('UI fixture did not become ready: ' + label);
};
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
    const openFixture = async () => {
      const window = new BrowserWindow({
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
      window.webContents.on('console-message', ({ level, message }) => {
        if (level >= 3) {
          rendererErrors.push(message);
          console.error('RENDERER', message);
        }
      });
      window.webContents.debugger.attach('1.3');
      await window.loadFile(path.join(output, 'index.html'));
      return window;
    };
    win = await openFixture();
    const results = [];
    const queueOnly = await evaluate('uiQueueOnly');
    for (const artwork of queueOnly ? [] : [false, true])
      for (const throttle of [1, 4])
        for (const count of [300, 1000]) {
          await win.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate', {
            rate: throttle,
          });
          await evaluate(`mountUi(${count},${artwork})`);
          // Await real loading/commit state. Deliberately delayed library stats must not
          // be counted as progress-induced renders, even on an overloaded machine.
          await until(
            '!!window.uiControls && window.uiLibrary?.stats.durationSeconds === 1 && !window.uiLibrary.loadingTracks && window.uiArtist?.loading === false',
            'initial model data',
          );
          await evaluate('switchUiTrack(0)');
          await until(
            'window.uiState?.currentTrack?.id === "sc_100000" && window.uiState.isPlaying',
            'initial playback',
          );
          const observed = await evaluate('uiProbe.renders');
          assert.ok(
            observed.TrackTable > 0 && observed.TrackRow > 0,
            'Profiling counters must observe real table and row renders before measuring their absence',
          );
          assert.ok(
            await evaluate('uiProbe.rootProfiles.length > 0'),
            'Public React Profiler must observe committed renders',
          );
          const measure = async (kind, samples) => {
            await evaluate(
              'uiProbe.renders={};uiProbe.rootProfiles=[];uiProbe.profiles=[];uiProbe.persistence=[];uiProbe.syncCommands=[];uiProbe.dispatches=[]',
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
              '({renders:uiProbe.renders,rootProfiles:uiProbe.rootProfiles,profiles:uiProbe.profiles,persistence:uiProbe.persistence,syncCommands:uiProbe.syncCommands,dispatches:uiProbe.dispatches,domRows:document.querySelectorAll("[draggable]").length})',
            );
            return {
              kind,
              samples,
              renders: metrics.renders,
              domRows: metrics.domRows,
              reactCommitCount: metrics.rootProfiles.length,
              reactRenderPass: stats(metrics.rootProfiles.map((value) => value.actualDuration)),
              trackTableRender: stats(metrics.profiles.map((value) => value.actualDuration)),
              actionToDom: stats(latencies),
              syncCommand: stats(metrics.syncCommands),
              syncDispatch: stats(metrics.dispatches),
              persistence: stats(metrics.persistence.map((value) => value.duration)),
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
    if (!queueOnly) {
      // Avoid carrying pending media work and CPU throttling into the queue fixture.
      const previous = win;
      win = await openFixture();
      previous.destroy();
    }
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true,
    });
    const queueResults = [];
    for (const count of [100, 1000, 10000]) {
      await evaluate(`mountQueue(${count})`);
      queueResults.push(
        await evaluate(`(async()=>{
        const wait=async (check)=>{
          for(let i=0;i<240;i++){if(check())return;await new Promise(r=>setTimeout(r,8));}
          throw Error('Queue did not render the expected rows');
        };
        const rows=()=>document.querySelectorAll('[data-queue-drawer] [role="listitem"]');
        const observe=(phase,action,ready)=>new Promise((resolve,reject)=>{
          const started=performance.now();
          const observer=new MutationObserver(check);
          const timer=setTimeout(()=>{
            observer.disconnect();
            reject(Error('Queue ${count} did not commit after '+phase+'; rows='+rows().length+'; last='+rows()[rows().length-1]?.textContent));
          },5000);
          function check() {
            if(!ready())return;
            observer.disconnect();
            clearTimeout(timer);
            resolve(performance.now()-started);
          }
          observer.observe(document.getElementById('root'),{subtree:true,childList:true,attributes:true});
          action();
          check();
        });
        await wait(()=>document.getElementById('open-queue')?.dataset.count==='${count}');
        const openMs=await observe('opening',()=>document.getElementById('open-queue').click(),()=>rows().length>0);
        const openRows=rows().length;
        const scroll=document.querySelector('.queue-scroll');
        const firstControl=rows()[0].querySelector('.queue-more');
        firstControl.focus({preventScroll:true});
        const scrollMs=await observe('scrolling',()=>{
          scroll.scrollTop=scroll.scrollHeight;
          scroll.dispatchEvent(new Event('scroll'));
        },()=>{
          const items=rows();
          const last=items[items.length-1];
          return last?.textContent.includes('Measured song ${count}');
        });
        if(document.activeElement!==firstControl)throw Error('Scrolling unmounted the focused queue row');
        const scrollRows=rows().length;
        if(${count}===1000&&!window.uiQueueAllRows){
          firstControl.blur();
          scroll.scrollTop=0;
          scroll.dispatchEvent(new Event('scroll'));
          await wait(()=>rows()[1]?.getAttribute('aria-posinset')==='2');
          const raf=window.requestAnimationFrame,caf=window.cancelAnimationFrame;
          const transfer=new DataTransfer();
          const source=rows()[0].querySelector('[draggable]');
          try {
            // Hidden Electron does not supply regular animation frames.
            window.requestAnimationFrame=callback=>setTimeout(callback,16);
            window.cancelAnimationFrame=clearTimeout;
            source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
            scroll.dispatchEvent(new DragEvent('dragover',{
              bubbles:true,cancelable:true,dataTransfer:transfer,
              clientY:Math.round(scroll.getBoundingClientRect().bottom)-5,
            }));
            await wait(()=>scroll.scrollTop>840);
            if(!source.isConnected)throw Error('Scrolling unmounted the active drag source');
            const target=rows()[rows().length-1];
            const targetPosition=Number(target.getAttribute('aria-posinset'));
            target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
            if(window.queueReorders[0]?.join(':')!=='1:'+targetPosition)
              throw Error('Dropping after auto-scroll used the wrong queue index');
            source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));
            const stoppedAt=scroll.scrollTop;
            await new Promise(resolve=>setTimeout(resolve,60));
            if(scroll.scrollTop!==stoppedAt)throw Error('Queue kept scrolling after drag ended');
          } finally {
            window.requestAnimationFrame=raf;
            window.cancelAnimationFrame=caf;
          }
        }
        return {tracks:${count},openMs,openRows,scrollMs,scrollRows};
      })()`),
      );
    }
    const queueAllRows = await evaluate('uiQueueAllRows');
    if (!queueAllRows) {
      for (const result of queueResults)
        assert.ok(result.openRows <= 40 && result.scrollRows <= 40, 'Queue rendered too many rows');
    }
    // Preserve diagnostics even when a rendering contract fails.
    fs.writeFileSync(report, JSON.stringify({ results, queueResults, externalRequests }, null, 2));
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
        queueAllRows,
        domTiming: 'MutationObserver registered before dispatch; no timer polling',
        renderer: 'React 19 production profiling build',
        profiling:
          'public React Profiler actualDuration and commit count; AST-instrumented production component invocation counters; commit/passive-effect durations are not measured',
        transport:
          'EventTarget fixture audio; real useAudioPlayerCore, AudioProvider, context hooks, TrackTable and TrackRow',
        profile: 'isolated temporary Electron userData',
        externalRequests,
        artwork: 'missing fields and fully populated stable file URLs; no network artwork',
        screen: 'hidden BrowserWindow, backgroundThrottling=false; no frame-presentation claims',
        readiness:
          'Actual model loading state and committed playback; initial stats delayed by 500ms',
      },
      results,
      queueResults,
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
