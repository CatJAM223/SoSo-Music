const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path'),
  assert = require('node:assert/strict');
const output = path.resolve(process.argv[2]);
app.setPath('userData', path.join(output, 'profile'));
app.setPath('sessionData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});
const startedAt = performance.now();
const operationTimings = [];
let activeOperation = null;
function reportProgress(reason) {
  const report = {
    reason,
    elapsedMs: Math.round(performance.now() - startedAt),
    activeOperation,
    operations: operationTimings,
  };
  fs.writeFileSync(
    path.join(path.dirname(output), 'desktop-ui-stage-timings.json'),
    JSON.stringify(report, null, 2),
  );
  if (reason !== 'passed') console.error('UI_STAGE_DIAGNOSTIC ' + JSON.stringify(report));
}
const timeout = setTimeout(() => {
  reportProgress('overall timeout');
  app.exit(1);
}, 40000);
app
  .whenReady()
  .then(async () => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
      callback({
        cancel:
          !details.url.startsWith('file://') &&
          !details.url.startsWith('devtools://') &&
          !details.url.startsWith('blob:') &&
          !details.url.startsWith('data:'),
      }),
    );
    const window = new BrowserWindow({
      show: false,
      useContentSize: true,
      width: 1200,
      height: 800,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: true,
      },
    });
    // Browser promises (notably hidden-window animation/capture work) can hang without
    // rejecting. Bound each operation and keep its source label for useful failures.
    for (const [method, budgetMs] of [
      ['executeJavaScript', 12000],
      ['capturePage', 6000],
      ['loadFile', 10000],
    ]) {
      const invoke = window.webContents[method].bind(window.webContents);
      window.webContents[method] = async (...args) => {
        const operation = {
          index: operationTimings.length + 1,
          method,
          label:
            typeof args[0] === 'string'
              ? args[0].replace(/\s+/g, ' ').slice(0, 160)
              : JSON.stringify(args[0] ?? null),
          startedMs: Math.round(performance.now() - startedAt),
        };
        activeOperation = operation;
        let timer, framePump;
        try {
          // Offscreen Chromium generates frames only when something is dirty. A
          // double RAF can otherwise wait forever once a clip/animation stops.
          // Request real compositor paints while a test explicitly waits on RAF;
          // do not replace RAF with sleep or skip its layout/video assertions.
          if (method === 'executeJavaScript' && args[0].includes('requestAnimationFrame')) {
            window.webContents.invalidate();
            framePump = setInterval(() => window.webContents.invalidate(), 16);
          }
          let paintedImage;
          if (method === 'capturePage') {
            // An offscreen window already supplies the composited NativeImage.
            // Read that frame directly: a second surface-copy request can fail
            // with UnknownVizError after a resize on headless Windows runners.
            paintedImage = await new Promise((resolve, reject) => {
              const [width, height] = window.getContentSize();
              const finish = (error, image) => {
                clearTimeout(deadline);
                clearInterval(pump);
                window.webContents.off('paint', painted);
                if (error) reject(error);
                else resolve(image);
              };
              const painted = (_event, _dirty, image) => {
                const size = image.getSize();
                if (size.width === width && size.height === height) finish(null, image);
              };
              const deadline = setTimeout(
                () => finish(Error('Current-size capture frame did not paint')),
                2000,
              );
              const pump = setInterval(() => window.webContents.invalidate(), 16);
              window.webContents.on('paint', painted);
              window.webContents.invalidate();
            });
            if (args[0]) paintedImage = paintedImage.crop(args[0]);
            assert.ok(!paintedImage.isEmpty(), 'Captured offscreen frame must contain pixels');
          }
          const result = await Promise.race([
            paintedImage ? Promise.resolve(paintedImage) : invoke(...args),
            new Promise((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    Error(
                      'UI operation timed out after ' +
                        budgetMs +
                        'ms: ' +
                        method +
                        ' ' +
                        operation.label,
                    ),
                  ),
                budgetMs,
              );
            }),
          ]);
          operation.ok = true;
          return result;
        } catch (error) {
          operation.error = String(error);
          throw error;
        } finally {
          clearTimeout(timer);
          clearInterval(framePump);
          operation.elapsedMs = Math.round(performance.now() - startedAt) - operation.startedMs;
          operationTimings.push(operation);
          activeOperation = null;
        }
      };
    }
    window.webContents.on('render-process-gone', (_event, details) => {
      reportProgress('renderer gone: ' + details.reason);
      app.exit(1);
    });
    window.on('unresponsive', () => {
      reportProgress('window unresponsive');
      app.exit(1);
    });
    const errors = [];
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(event.message);
    });
    try {
      await window.loadFile(path.join(output, 'index.html'));
      // Exercise animation explicitly even when the Windows runner disables motion.
      // Keep this session attached so restoring an emulated feature cannot fall
      // back to the host's preference before later animation assertions.
      window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
      });
      const fonts = await window.webContents.executeJavaScript(`(async()=>{
      const poppins=await document.fonts.load('400 16px Poppins','Music');
      const bold=await document.fonts.load('900 16px Poppins','Music');
      const numeric=await document.fonts.load('400 16px "JetBrains Mono"','0123456789');
      const russian=await document.fonts.load('400 16px Roboto','Моя волна');
      if(!poppins.length||!bold.length||!numeric.length||!russian.length)throw Error('Bundled font failed to load');
      const probe=document.createElement('span');probe.className='tabular-nums';probe.textContent='0123456789';document.body.appendChild(probe);
      const family=getComputedStyle(probe).fontFamily;if(!family.includes('JetBrains Mono'))throw Error('Numeric font was not applied');probe.remove();
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font='400 32px "JetBrains Mono"';
      if(Math.abs(ctx.measureText('1111').width-ctx.measureText('8888').width)>0.01)throw Error('Digits are not fixed width');
      return {poppins:poppins.length,bold:bold.length,numeric:numeric.length,russian:russian.length};
    })()`);
      console.log('BUNDLED_FONTS_OK ' + JSON.stringify(fonts));
      await window.webContents.executeJavaScript(
        'document.documentElement.classList.add("dark");document.documentElement.dataset.theme="wallpaper";document.documentElement.style.setProperty("--theme-accent-rgb","234, 179, 8");',
      );
      for (const [layout, width, height] of [['desktop', 1200, 800]]) {
        window.setContentSize(width, height);
        await window.webContents.executeJavaScript(
          `(async()=>{window.renderNetworkFixture('network',true);for(let i=0;i<50&&!document.querySelector('[role="status"]');i++)await new Promise(r=>setTimeout(r,20));const notice=document.querySelector('[role="status"]'),rect=notice.getBoundingClientRect();if(rect.left<0||rect.right>innerWidth||rect.bottom>innerHeight)throw Error('Network notice overflow');if(!notice.textContent.includes('Трек и позиция сохранены'))throw Error('Missing preserved position message');const buttons=[...notice.querySelectorAll('button')];buttons[0].click();buttons[1].click();if(window.fixtureNetworkActions.join(',')!=='pause,retry')throw Error('Recovery controls disconnected');})()`,
        );
        await window.webContents.executeJavaScript(
          'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
        );
        const screenshot = await window.webContents.capturePage();
        fs.writeFileSync(
          path.join(path.dirname(output), 'network-safety-' + layout + '.png'),
          screenshot.toPNG(),
        );
      }
      await window.webContents.executeJavaScript(
        `(async()=>{window.renderNetworkFixture(null,true);Object.defineProperty(navigator,'onLine',{value:false,configurable:true});window.dispatchEvent(new Event('offline'));await new Promise(r=>setTimeout(r,30));const notice=document.querySelector('[role="status"]');if(!notice?.textContent.includes('Нет подключения к интернету')||notice.querySelector('button'))throw Error('Offline notice must explain downloaded playback without retry controls');Object.defineProperty(navigator,'onLine',{value:true,configurable:true});window.dispatchEvent(new Event('online'));await new Promise(r=>setTimeout(r,30));if(document.querySelector('[role="status"]'))throw Error('Offline notice stayed after recovery');})()`,
      );
      console.log(
        'NETWORK_RECOVERY_NOTICE_OK: desktop/mobile fit, retry/pause connected, offline/online state updates',
      );
      for (const [layout, width, height] of [['desktop', 1200, 800]]) {
        window.setContentSize(width, height);
        await window.webContents.executeJavaScript(
          'window.renderFixture(' + JSON.stringify(layout) + ')',
        );
        const measurement = await window.webContents.executeJavaScript(
          [
            '(async()=>{for(let i=0;i<100;i++){',
            'const scroll=document.querySelector(".karaoke-lyrics-scroll"),first=scroll?.querySelector("[data-karaoke-line]");',
            'if(first&&scroll.clientHeight>0){await new Promise(resolve=>setTimeout(resolve,300));',
            'const a=scroll.getBoundingClientRect(),b=first.getBoundingClientRect();',
            'return {gap:b.top-a.top,firstBottom:b.bottom,top:a.top,bottom:a.bottom,height:a.height,overflow:document.documentElement.scrollWidth-innerWidth};}',
            'await new Promise(resolve=>setTimeout(resolve,25));}throw Error("Lyrics did not render");})()',
          ].join(''),
        );
        assert.ok(
          measurement.gap >= -2 && measurement.gap <= 64,
          layout +
            ': intro should start near the top of its lyrics viewport: ' +
            JSON.stringify(measurement),
        );
        assert.ok(
          measurement.firstBottom <= measurement.bottom,
          layout + ': intro must be visible',
        );
        assert.ok(measurement.height >= 120, layout + ': lyrics area should be usable');
        assert.ok(measurement.overflow <= 1, layout + ': modal must fit horizontally');
        console.log('UI_LAYOUT_OK ' + layout + ' ' + JSON.stringify(measurement));
        const cueResult = await window.webContents.executeJavaScript(`(async()=>{
        const advance=async(time,playing=false)=>{
          window.fixtureKaraokeClockRead=null;window.setKaraokeClock(time,playing);
          for(let i=0;i<60&&window.fixtureKaraokeClockRead!==time;i++)await new Promise(r=>setTimeout(r,10));
          if(window.fixtureKaraokeClockRead!==time)throw Error('Karaoke media clock was not read');
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const next=time<12?12:time>=21.5&&time<30?30:null;
          const remaining=next===null?0:next-time;
          const phase=remaining>4.25?'dots':remaining>3.6?'line':'countdown';
          const digit=phase==='countdown'?String(Math.min(3,Math.ceil(remaining))):undefined;
          for(let i=0;i<60;i++){
            const cue=document.querySelector('.karaoke-wait[data-active="true"]');
            if(next===null&&!cue)return null;
            if(next!==null&&cue?.dataset.phase===phase&&cue.dataset.countdown===digit)return cue;
            await new Promise(r=>setTimeout(r,10));
          }
          throw Error('Cue did not reach media time '+time);
        };
        const read=cue=>({phase:cue.dataset.phase,digit:cue.dataset.countdown,paths:[...cue.querySelectorAll('path')].map(p=>[p.getAttribute('d'),p.getAttribute('stroke-dasharray'),p.getAttribute('stroke-dashoffset')])});
        let cue=await advance(0.2,true);const dots=read(cue);
        if(dots.phase!=='dots'||getComputedStyle(cue).backgroundColor!=='rgba(0, 0, 0, 0)'||getComputedStyle(cue).borderTopWidth!=='0px')throw Error('Cue still has a capsule');
        const moved=read(await advance(0.4,true));if(JSON.stringify(dots.paths)===JSON.stringify(moved.paths))throw Error('Dots do not jump');
        if((await advance(8.25,true)).dataset.phase!=='line')throw Error('Dots did not join a line');
        const shapes=[];
        for(const [time,digit] of [[9.4,'3'],[10.4,'2'],[11.4,'1']]){cue=await advance(time,true);if(cue.dataset.countdown!==digit)throw Error('Wrong cue digit at '+time);shapes.push(read(cue).paths);}
        if(new Set(shapes.map(s=>JSON.stringify(s))).size!==3)throw Error('Digits do not change shape');
        const node=cue.querySelector('path');if(cue.querySelectorAll('path').length!==1||getComputedStyle(cue.parentElement).transform!=='none')throw Error('Cue must use one stroke without scale bounce');
        const size=cue.querySelector('svg').getBoundingClientRect();if(size.height>40.5)throw Error('Countdown too large');
        await advance(9.72,false);const midway=JSON.stringify(read(cue).paths);await advance(9.82,false);if(cue.querySelector('path')!==node||midway===JSON.stringify(read(cue).paths))throw Error('Existing line must continuously morph');
        const ink=async()=>{
          const svg=cue.querySelector('svg').cloneNode(true);svg.setAttribute('stroke','#ffffff');
          const img=new Image(),ready=new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;});
          img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));await ready;
          const canvas=document.createElement('canvas');canvas.width=64;canvas.height=40;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
          const pixels=ctx.getImageData(0,0,64,40).data;let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>32)count++;return count;
        };
        cue=await advance(9.2,false);const fullInk=await ink();
        cue=await advance(9.7,false);const curlInk=await ink();
        const dash=cue.querySelector('path');if(dash.getAttribute('pathLength')!=='1'||Number(dash.getAttribute('stroke-dasharray')?.split(' ')[0])>=.4)throw Error('Stroke does not contract to a curl');
        if(curlInk>=fullInk*.65||curlInk<fullInk*.03)throw Error('Actual SVG paint must contract but stay visible: '+fullInk+' → '+curlInk);
        cue=await advance(9.72,false);const paused=read(cue);await new Promise(r=>setTimeout(r,120));if(JSON.stringify(paused)!==JSON.stringify(read(cue)))throw Error('Paused cue still moves');
        if((await advance(0.2,false)).dataset.phase!=='dots')throw Error('Backward seek did not restore dots');
        if(await advance(12,true))throw Error('Countdown remains after lyric starts');
        cue=await advance(27.4,true);if(cue.dataset.countdown!=='3')throw Error('Instrumental break used intro instead of next lyric');
        cue=await advance(10.4,false);for(let i=0;i<30&&cue?.dataset.countdown!=='2';i++){await new Promise(r=>setTimeout(r,20));cue=document.querySelector('.karaoke-wait[data-active="true"]');}if(cue?.dataset.countdown!=='2')throw Error('Cue did not settle after backward seek');
        return {dots:true,line:true,digits:3,pause:true,seek:true,interlude:true};
      })()`);
        console.log('KARAOKE_WAIT_OK ' + layout + ' ' + JSON.stringify(cueResult));
        await new Promise((r) => setTimeout(r, 350));
        const cueScreenshots = path.join(__dirname, '../../scratch/karaoke-countdown-2026-10-04');
        fs.mkdirSync(cueScreenshots, { recursive: true });
        fs.writeFileSync(
          path.join(cueScreenshots, layout + '-countdown.png'),
          (
            await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
          ).toPNG(),
        );
        await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
        const reduced = await window.webContents.executeJavaScript(
          String.raw`(()=>{const cue=document.querySelector('.karaoke-wait[data-active="true"]');return {svg:getComputedStyle(cue.querySelector('svg')).display,still:getComputedStyle(cue.querySelector('span')).display,text:cue.querySelector('span').textContent};})()`,
        );
        assert.deepEqual(reduced, { svg: 'none', still: 'block', text: '2' });
        await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
        });
        await window.webContents.executeJavaScript('window.setKaraokeClock(0,false)');
      }

      // Decode a locally generated widescreen video in the actual shared React modal.
      await window.webContents.executeJavaScript(
        '(async()=>{const canvas=document.createElement("canvas");canvas.width=320;canvas.height=180;const ctx=canvas.getContext("2d");const draw=()=>{ctx.fillStyle="#20c070";ctx.fillRect(0,0,320,180);};draw();const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:"video/webm;codecs=vp8"}),chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();const timer=setInterval(draw,35);await new Promise(r=>setTimeout(r,1300));recorder.stop();await done;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());window.fixtureVideoUrl=URL.createObjectURL(new Blob(chunks,{type:"video/webm"}));})()',
      );
      for (const [layout, width, height] of [['desktop', 1200, 800]]) {
        window.setContentSize(width, height);
        await window.webContents.executeJavaScript(
          'window.renderVideoFixture(' + JSON.stringify(layout) + ')',
        );
        if (layout === 'mobile') {
          const activated = await window.webContents.executeJavaScript(
            '(async()=>{for(let i=0;i<100;i++){const button=[...document.querySelectorAll(".karaoke-art button")].find(b=>b.getAttribute("aria-label")==="Показать клип");if(button&&button.title==="Показать видеоклип"){button.click();return;}await new Promise(r=>setTimeout(r,20));}return {error:"Mobile clip toggle did not become ready",buttons:[...document.querySelectorAll(".karaoke-art button")].map(b=>({title:b.title,label:b.getAttribute("aria-label")}))};})()',
          );
          if (activated) throw Error(JSON.stringify(activated));
        }
        const measured = await window.webContents.executeJavaScript(
          '(async()=>{for(let i=0;i<150;i++){const video=document.querySelector(".karaoke-art video");if(video?.readyState>=2){await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const box=video.getBoundingClientRect();return {fit:getComputedStyle(video).objectFit,width:box.width,height:box.height,x:box.left,y:box.top,requests:window.fixtureVideoRequests,decoded:video.videoWidth>0};}await new Promise(r=>setTimeout(r,20));}throw Error("Automatic clip retry failed to decode a frame");})()',
        );
        assert.equal(measured.fit, layout === 'desktop' ? 'cover' : 'contain');
        assert.equal(measured.decoded, true);
        assert.equal(measured.requests.length, 2, 'One failed lookup gets one automatic retry');
        assert.equal(measured.requests[1].options.forceRefresh, true);
        if (layout === 'desktop') {
          assert.ok(
            Math.abs(measured.width - measured.height) < 1,
            'Desktop clip must fill the square',
          );
          await window.webContents.executeJavaScript(
            'new Promise((resolve,reject)=>{const video=document.querySelector(".karaoke-art video");const timer=setTimeout(()=>reject(Error("Video did not present a frame")),2000);video.requestVideoFrameCallback(()=>{clearTimeout(timer);requestAnimationFrame(()=>requestAnimationFrame(resolve));});})',
          );
          const shot = await window.webContents.capturePage(
            {
              x: Math.floor(measured.x),
              y: Math.floor(measured.y),
              width: Math.floor(measured.width),
              height: Math.floor(measured.height),
            },
            { stayHidden: true, stayAwake: true },
          );
          const pixels = shot.toBitmap(),
            size = shot.getSize(),
            index = (Math.floor(size.height * 0.08) * size.width + Math.floor(size.width / 2)) * 4;
          assert.ok(
            pixels[index + 1] > 120,
            'Decoded video, rather than a black bar, must occupy the top of the square',
          );
          const screenshots = path.join(__dirname, '../../scratch/release-preparation-2026-10-04');
          fs.mkdirSync(screenshots, { recursive: true });
          fs.writeFileSync(path.join(screenshots, 'desktop-video-fill.png'), shot.toPNG());
        }
        await window.webContents.executeJavaScript(
          'window.rerenderVideoFixture(' + JSON.stringify(layout) + ')',
        );
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(
          await window.webContents.executeJavaScript('window.fixtureVideoRequests.length'),
          2,
          'Duration metadata must not restart a clip',
        );
        // Simulate a media-element rejection after the first automatic retry was used.
        await window.webContents.executeJavaScript(
          '(async()=>{document.querySelector(".karaoke-art video").dispatchEvent(new Event("error"));for(let i=0;i<100;i++){const iframe=document.querySelector(".karaoke-art iframe");if(iframe){window.dispatchEvent(new MessageEvent("message",{source:iframe.contentWindow,data:JSON.stringify({event:"onError",info:150})}));break;}await new Promise(r=>setTimeout(r,20));}for(let i=0;i<100;i++){const button=document.querySelector(".karaoke-art button");if(button?.textContent.includes("Повторить")){button.click();return;}await new Promise(r=>setTimeout(r,20));}throw Error("Manual retry button missing");})()',
        );
        const manual = await window.webContents.executeJavaScript(
          '(async()=>{for(let i=0;i<100;i++){const video=document.querySelector(".karaoke-art video");if(video?.readyState>=2)return window.fixtureVideoRequests;await new Promise(r=>setTimeout(r,20));}throw Error("Manual retry failed to decode a frame");})()',
        );
        assert.equal(
          manual.length,
          3,
          'Manual retry makes a new request after the failed cached link',
        );
        assert.equal(manual[2].options.forceRefresh, true);
        console.log(
          'VIDEO_STARTUP_OK ' +
            layout +
            ': automatic and manual retries decode frames, fit=' +
            measured.fit,
        );
      }

      // Reuse the actual modal through A→B→A, including a late result for the abandoned A request.
      window.setContentSize(1200, 800);
      await window.webContents.executeJavaScript('window.renderVideoFixture("desktop")');
      const switches = await window.webContents.executeJavaScript(String.raw`(async()=>{
      let late;window.fixtureStreamResolver=id=>id==="switchA0001"&&!late?new Promise(resolve=>{late=resolve;}):Promise.resolve(window.fixtureVideoUrl);
      window.switchClipFixture("switchA0001");
      for(let i=0;i<100&&!late;i++)await new Promise(r=>setTimeout(r,20));
      if(!late)throw Error("First track did not request its clip");
      const playing=async()=>{for(let i=0;i<150;i++){
        const video=document.querySelector(".karaoke-art video");
        if(video?.dataset.clipId===window.fixtureClipId&&video.readyState>=2&&!video.paused&&video.currentTime>0.06)return video;
        await new Promise(r=>setTimeout(r,20));
      }throw Error("Clip did not advance after switching: "+window.fixtureClipId);};
      window.switchClipFixture("switchB0001");let b=await playing();
      late("https://invalid.example/abandoned.mp4");await new Promise(r=>setTimeout(r,50));
      if(document.querySelector(".karaoke-art video")!==b)throw Error("Late first track replaced the playing second track");
      let starts=1;
      for(let i=0;i<6;i++){
        window.switchClipFixture(i%2?"switchB0001":"switchA0001");
        const next=await playing();starts++;
        b.dispatchEvent(new Event("error"));await new Promise(r=>setTimeout(r,20));
        if(document.querySelector(".karaoke-art video")!==next)throw Error("Old video error reset the current clip");
        b=next;
      }
      window.switchClipFixture("switchA0001",false);await new Promise(r=>setTimeout(r,50));
      if(document.querySelector(".karaoke-art video"))throw Error("Closed clip still mounted");
      window.switchClipFixture("switchA0001",true);await playing();starts++;
      window.fixtureStreamResolver=null;
      return {starts,requests:window.fixtureVideoRequests.length};
    })()`);
      assert.equal(switches.starts, 8);
      console.log(
        'VIDEO_TRACK_SWITCH_OK ' +
          JSON.stringify(switches) +
          ': frames advance, stale responses/errors ignored, reopen plays',
      );

      window.setContentSize(1200, 800);
      await window.webContents.executeJavaScript('window.renderConnectionFixture()');
      await window.webContents.executeJavaScript(
        '(async()=>{for(let i=0;i<100&&!window.fixtureListenersReady();i++)await new Promise(r=>setTimeout(r,20));if(!window.fixtureListenersReady())throw Error("Dialog listeners did not mount");document.documentElement.classList.add("dark");document.documentElement.style.setProperty("--theme-accent","#eab308");document.documentElement.style.setProperty("--theme-accent-rgb","234,179,8");window.fixturePush({id:"one",address:"192.168.1.4",tracks:29,playlists:2,albums:1,artists:2});await new Promise(r=>setTimeout(r,350));})()',
      );
      const measure = await window.webContents.executeJavaScript(
        '(()=>{document.querySelector(".soso-connection-backdrop").getAnimations().forEach(a=>a.finish());const dialog=document.querySelector(".soso-connection-dialog"),r=dialog.getBoundingClientRect();return {viewportWidth:innerWidth,viewportHeight:innerHeight,title:dialog.querySelector("h2").textContent,left:r.left,top:r.top,width:r.width,height:r.height,focus:document.activeElement.textContent,accent:getComputedStyle(dialog.querySelector(".soso-connection-primary")).backgroundColor};})()',
      );
      assert.equal(measure.title, 'Принять медиатеку?');
      assert.equal(measure.focus, 'Отмена');
      assert.ok(Math.abs(measure.left + measure.width / 2 - measure.viewportWidth / 2) < 1);
      assert.ok(Math.abs(measure.top + measure.height / 2 - measure.viewportHeight / 2) < 1);
      assert.equal(measure.accent, 'rgb(234, 179, 8)');
      const screenshots = path.join(__dirname, '../../scratch/release-preparation-2026-10-04');
      fs.mkdirSync(screenshots, { recursive: true });
      await window.webContents.executeJavaScript(
        'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
      );
      fs.writeFileSync(
        path.join(screenshots, 'library-consent.png'),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG(),
      );
      await window.webContents.executeJavaScript(
        'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));',
      );
      await new Promise((r) => setTimeout(r, 30));
      assert.deepEqual(await window.webContents.executeJavaScript('window.fixtureResponses'), [
        { id: 'one', accepted: false },
      ]);
      await window.webContents.executeJavaScript(
        'window.fixturePush({id:"two",address:"192.168.1.4",tracks:29,playlists:2,albums:1,artists:2});',
      );
      await new Promise((r) => setTimeout(r, 30));
      await window.webContents.executeJavaScript(
        'document.querySelector(".soso-connection-primary").click()',
      );
      await new Promise((r) => setTimeout(r, 30));
      assert.deepEqual(await window.webContents.executeJavaScript('window.fixtureResponses'), [
        { id: 'one', accepted: false },
        { id: 'two', accepted: true },
      ]);
      await window.webContents.executeJavaScript(
        'window.fixturePush({id:"expired",address:"192.168.1.4",tracks:29,playlists:2,albums:1,artists:2})',
      );
      await new Promise((r) => setTimeout(r, 30));
      await window.webContents.executeJavaScript('window.fixturePush(null)');
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(
        await window.webContents.executeJavaScript(
          '!!document.querySelector(".soso-connection-dialog")',
        ),
        false,
      );
      await window.webContents.executeJavaScript('window.fixtureConnected()');
      await new Promise((r) => setTimeout(r, 200));
      const before = await window.webContents.executeJavaScript(
        '(()=>{const path=document.querySelector(".soso-connection-check path"),animation=path.getAnimations()[0];animation.pause();animation.currentTime=200;return getComputedStyle(path).d;})()',
      );
      await new Promise((r) => setTimeout(r, 30));
      const after = await window.webContents.executeJavaScript(
        '(()=>{const path=document.querySelector(".soso-connection-check path"),animation=path.getAnimations()[0];animation.currentTime=1300;return getComputedStyle(path).d;})()',
      );
      assert.notEqual(before, after, 'Circle must morph into a check');
      assert.match(after, /15 33/);
      await window.webContents.executeJavaScript(
        'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
      );
      fs.writeFileSync(
        path.join(screenshots, 'account-connected.png'),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG(),
      );
      await window.webContents.executeJavaScript(
        'document.querySelector(".soso-connection-primary").click()',
      );
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(
        await window.webContents.executeJavaScript(
          '!!document.querySelector(".soso-connection-dialog")',
        ),
        false,
      );
      console.log(
        'CONNECTION_DIALOGS_OK: centered themed consent, explicit accept/cancel, server cancellation, circle→check animation',
      );

      // The new account hint runs against the real dialog and opens the real integrations settings.
      const hintResult = await window.webContents.executeJavaScript(String.raw`(async()=>{
      const wait=async check=>{for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error("Hint UI did not reach expected state");};
      const emit=reason=>window.dispatchEvent(new CustomEvent('soso:youtube-access-issue',{detail:{reason,source:'clip',trackId:'yt_access001'}}));
      const dialog=()=>document.querySelector('.youtube-access-panel');
      window.renderAccessFixture();await wait(()=>!!window.fixtureAccountChanged);
      const before=window.fixtureAccountChecks;
      window.dispatchEvent(new CustomEvent('soso:youtube-access-issue',{detail:{reason:'unavailable',source:'clip',trackId:'yt_access001'}}));
      window.dispatchEvent(new CustomEvent('soso:youtube-access-issue',{detail:{reason:'age-restricted',source:'clip',trackId:'old-track'}}));
      await new Promise(r=>setTimeout(r,40));if(window.fixtureAccountChecks!==before)throw Error('Generic/stale errors must not request an account hint');
      emit('age-restricted');await wait(dialog);
      const rect=dialog().getBoundingClientRect();if(Math.abs(rect.left+rect.width/2-innerWidth/2)>1||Math.abs(rect.top+rect.height/2-innerHeight/2)>1)throw Error('Hint must be centered');
      if(!dialog().textContent.includes('подтверждённым возрастом'))throw Error('Age guidance missing');
      const actions=dialog().querySelector('footer'),actionsStyle=getComputedStyle(actions);
      if(actionsStyle.backgroundColor!=='rgba(0, 0, 0, 0)'||actionsStyle.backdropFilter!=='none')throw Error('Wallpaper player styling leaked into dialog actions');
      const buttons=[...actions.querySelectorAll('button')].map(button=>button.getBoundingClientRect());
      if(buttons.some(button=>button.height<40)||Math.abs(buttons[0].height-buttons[1].height)>1)throw Error('Dialog buttons must have matching usable heights');
      if(getComputedStyle(dialog().querySelector('input')).appearance!=='none')throw Error('Checkbox must follow the settings palette');
      let backgroundKeys=0;const background=()=>backgroundKeys++;window.addEventListener('keydown',background);
      window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));window.removeEventListener('keydown',background);
      if(backgroundKeys)throw Error('Dialog keyboard event leaked to player shortcuts');
      dialog().querySelector('.settings-action-primary').focus();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
      if(document.activeElement!==dialog().querySelector('.settings-close'))throw Error('Focus escaped the account dialog');
      const checkbox=dialog().querySelector('input');checkbox.click();
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(()=>!dialog());
      emit('age-restricted');await new Promise(r=>setTimeout(r,60));if(dialog())throw Error('Suppressed age hint reopened');
      emit('verification-required');await wait(dialog);if(!dialog().textContent.includes('не бот'))throw Error('Bot guidance must be separate from age');
      window.fixtureAccountConnected=true;window.fixtureAccountChanged({connected:true,loginOpen:false});await wait(()=>!dialog());
      emit('verification-required');await wait(dialog);if(!dialog().textContent.includes('Обновить сессию'))throw Error('Connected account needs session guidance');
      dialog().querySelector('.settings-close').click();await wait(()=>!dialog());
      window.fixtureAccountChanged({connected:true,loginOpen:false});
      window.fixtureAccountConnected=false;window.fixtureStatusResolver=()=>new Promise(resolve=>window.fixtureFinishStatus=resolve);
      emit('verification-required');await wait(()=>!!window.fixtureFinishStatus);
      window.fixtureAccountChanged({connected:true,loginOpen:false});window.fixtureFinishStatus({connected:false,loginOpen:false});await new Promise(r=>setTimeout(r,60));
      if(dialog())throw Error('A late disconnected result reopened the hint after successful login');
      window.fixtureStatusResolver=null;
      emit('verification-required');await wait(dialog);dialog().querySelector('.settings-action-primary').click();
      await wait(()=>!!document.querySelector('.settings-tabs button.active'));
      if(document.querySelector('.settings-tabs button.active').textContent!=='Интеграции')throw Error('Hint must open integrations directly');
      if(!document.querySelector('.settings-modal-content').textContent.includes('Аккаунт YouTube'))throw Error('Account settings missing');
      return {suppressedAge:true,separateBot:true,connectedHidden:true,lateStatusIgnored:true,settings:document.querySelector('.settings-tabs button.active').textContent};
    })()`);
      console.log('YOUTUBE_ACCESS_HINT_OK ' + JSON.stringify(hintResult));
      const availabilityResult = await window.webContents.executeJavaScript(String.raw`(async()=>{
      const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Availability UI timed out: '+JSON.stringify({rows:document.querySelectorAll('.track-grid').length,inert:!!document.querySelector('.track-grid[inert]'),dialog:!!document.querySelector('.youtube-access-panel'),accountChanged:!!window.fixtureAccountChanged,disabled:window.fixtureYouTubeDisabled(),body:document.body.textContent.slice(-600)}));};
      window.renderAccessFixture();await wait(()=>!!window.fixtureAccountChanged);window.fixtureSetYouTubeDisabled(false);
      window.renderAvailabilityFixture();await wait(()=>document.querySelectorAll('.track-grid').length===2);
      window.dispatchEvent(new CustomEvent('soso:youtube-access-issue',{detail:{reason:'verification-required',source:'track',trackId:'yt_access001'}}));
      await wait(()=>document.querySelector('.youtube-access-panel'));document.querySelector('.youtube-access-actions .settings-action').click();
      await wait(()=>document.querySelector('.track-grid[inert]'));
      const [yt,sc]=document.querySelectorAll('.track-grid');if(getComputedStyle(yt).filter!=='grayscale(1)'||getComputedStyle(yt).pointerEvents!=='none')throw Error('YouTube row must be grey and inaccessible');
      if(sc.inert||sc.getAttribute('aria-disabled')==='true')throw Error('SoundCloud must remain usable');
      const before=document.activeElement;yt.querySelector('button').focus();if(document.activeElement!==before)throw Error('Disabled track button must not receive keyboard focus');
      sc.click();if(window.fixtureTrackClicks.join()!=='sc_access001')throw Error('SoundCloud row must still play');
      if(localStorage.getItem('soso_youtube_playback_disabled')!=='true')throw Error('Opt-out must persist');
      window.fixtureAccountChanged({connected:true,loginOpen:false});await wait(()=>!yt.inert);
      if(window.fixtureYouTubeDisabled())throw Error('Successful account connection must restore YouTube');
      window.fixtureSetYouTubeDisabled(true);await wait(()=>yt.inert);window.fixtureSuccessfulLogin();await wait(()=>!yt.inert);
      yt.click();if(window.fixtureTrackClicks.at(-1)!=='yt_access001')throw Error('Restored YouTube row must play');
      return {youtubeInert:true,soundcloudPlays:true,restoredAfterLogin:true};
    })()`);
      console.log('YOUTUBE_AVAILABILITY_OK ' + JSON.stringify(availabilityResult));
      const artworkResult = await window.webContents.executeJavaScript(`(async()=>{
      const wait=async test=>{for(let i=0;i<120;i++){if(test())return;await new Promise(r=>requestAnimationFrame(r));}const img=document.querySelector('.track-grid img');throw Error('Artwork did not load: '+JSON.stringify({src:img?.getAttribute('src')?.slice(0,180),width:img?.naturalWidth,complete:img?.complete,rect:img?.getBoundingClientRect().toJSON()}));};
      const svg=width=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="2"><rect width="100%" height="100%" fill="red"/></svg>');
      const track={id:'sc_artwork_a',title:'Cover A',source:'soundcloud',duration:200,artist:{name:'Fixture'},album:{cover_medium:'https://artwork.invalid/missing.jpg',cover_big:svg(2)}};
      window.renderArtworkFixture(track);
      await wait(()=>{const img=document.querySelector('.track-grid img');return img?.complete&&img.naturalWidth===2;});
      const first=document.querySelector('.track-grid img');
      window.renderArtworkFixture({...track,id:'sc_artwork_b',album:{...track.album,cover_big:svg(3)}});
      await wait(()=>{const img=document.querySelector('.track-grid img');return img?.complete&&img.naturalWidth===3;});
      if(document.querySelector('.track-grid img')===first)throw Error('Changed recording reused failed image state');
      window.renderArtworkFixture({...track,id:'sc_artwork_c',album:{cover_medium:track.album.cover_medium}});
      await wait(()=>{const img=document.querySelector('.track-grid img');return img?.complete&&img.naturalWidth>0&&img.getAttribute('src')===window.fixtureDefaultCover;});
      return {alternativeLoaded:true,trackSwitchReset:true,offlinePlaceholderLoaded:true};
    })()`);
      console.log('WAVE_ARTWORK_RECOVERY_OK ' + JSON.stringify(artworkResult));

      // Reload removes React state while preserving the saved 'do not show again' preference.
      await window.loadFile(path.join(output, 'index.html'));
      await window.webContents.executeJavaScript(
        'document.documentElement.classList.add("dark");document.documentElement.dataset.theme="wallpaper";document.documentElement.style.setProperty("--theme-accent-rgb","234, 179, 8");',
      );
      await window.webContents.executeJavaScript(
        '(async()=>{window.renderAccessFixture();for(let i=0;i<100&&!window.fixtureAccountChanged;i++)await new Promise(r=>setTimeout(r,20));window.dispatchEvent(new CustomEvent("soso:youtube-access-issue",{detail:{reason:"age-restricted",source:"clip",trackId:"yt_access001"}}));await new Promise(r=>setTimeout(r,60));if(document.querySelector(".youtube-access-panel"))throw Error("Suppressed hint returned after reload");})()',
      );
      await window.webContents.executeJavaScript(
        '(async()=>{localStorage.removeItem("soso_youtube_access_hint_hidden_age-restricted");window.fixtureSetYouTubeDisabled(false);window.renderGatedClipFixture();for(let i=0;i<150&&!document.querySelector(".youtube-access-panel");i++)await new Promise(r=>setTimeout(r,20));if(!document.querySelector(".youtube-access-panel"))throw Error("Actual clip age failure did not open account hint");await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const rect=document.querySelector(".youtube-access-panel").getBoundingClientRect();if(rect.width!==innerWidth||rect.height!==innerHeight)throw Error("Access warning must fill the viewport");if(window.fixtureVideoRequests.length!==1)throw Error("Verified age restriction must not retry the clip");})()',
      );
      fs.writeFileSync(
        path.join(screenshots, 'youtube-age-hint.png'),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG(),
      );
      window.setContentSize(390, 844);
      const smallHint = await window.webContents.executeJavaScript(
        'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const panel=document.querySelector(".youtube-access-panel"),rect=panel.getBoundingClientRect(),buttons=[...panel.querySelectorAll("footer button")].map(button=>button.getBoundingClientRect());resolve({left:rect.left,right:rect.right,bottom:rect.bottom,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,buttonsFit:buttons.every(button=>button.left>=rect.left&&button.right<=rect.right&&button.bottom<=rect.bottom)});})))',
      );
      assert.ok(
        smallHint.left >= 0 &&
          smallHint.right <= smallHint.width &&
          smallHint.bottom <= smallHint.height &&
          smallHint.overflow <= 1 &&
          smallHint.buttonsFit,
        'Account hint must fit a narrow viewport',
      );
      fs.writeFileSync(
        path.join(screenshots, 'youtube-age-hint-narrow.png'),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG(),
      );
      window.setContentSize(1200, 800);
      await window.webContents.executeJavaScript('window.fixtureStreamResolver=null');
      console.log(
        'YOUTUBE_CLIP_HINT_INTEGRATION_OK: actual clip error opens hint, fills viewport, persisted suppression survives reload',
      );

      // Native radio/switch preferences are exercised through all twelve actual tour steps.
      const tourResult = await window.webContents.executeJavaScript(String.raw`(async()=>{
      const wait=async check=>{for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error('Tour did not reach expected state');};
      localStorage.setItem('soso_guitar_player','false');localStorage.setItem('soso_guitar_mode','tabs');localStorage.setItem('soso_find_clips','false');
      const target=document.createElement('div');target.dataset.tour='sidebar-nav';Object.assign(target.style,{position:'fixed',left:'18px',top:'90px',width:'230px',height:'220px'});document.body.append(target);
      window.renderTourFixture();await wait(()=>document.querySelector('#onboarding-title')?.textContent==='Добро пожаловать');
      const next=async()=>{const current=document.querySelector('#onboarding-title').textContent;document.querySelector('.onboarding-panel [data-initial-focus]').click();await wait(()=>document.querySelector('#onboarding-title')?.textContent!==current);};
      await next();const box=document.querySelector('.onboarding-panel').getBoundingClientRect();if(box.left<0||box.right>innerWidth||box.bottom>innerHeight)throw Error('Spotlight tooltip outside viewport');
      target.remove();await next();if(!document.querySelector('#onboarding-title').textContent.includes('Поиск'))throw Error('Missing tour target cannot leave a blank overlay');
      for(let i=0;i<4;i++)await next();
      if(!document.querySelector('input[value="none"]').checked)throw Error('Existing guitar preference was overwritten on tour entry');
      document.querySelector('input[value="tabs"]').click();await next();const toggle=document.querySelector('.onboarding-panel [role="switch"]');if(toggle.getAttribute('aria-checked')!=='false')throw Error('Existing clip preference missing');toggle.click();await next();
      const overlayToggle=document.querySelector('.onboarding-overlay [role="switch"]');if(!overlayToggle||overlayToggle.disabled||overlayToggle.getAttribute('aria-checked')!=='true')throw Error('Missing overlay onboarding choice');overlayToggle.click();await next();
      if(window.fixtureOverlayPreferenceCalls.length)throw Error('Overlay applied before tour completion');
      if(document.querySelector('.onboarding-lastfm a')?.href!=='https://www.last.fm/api/account/create')throw Error('Last.fm key link missing in tour');
      await next();
      await wait(()=>[...document.querySelectorAll('.onboarding-panel button')].some(b=>b.textContent==='Добавить домены'));
      [...document.querySelectorAll('.onboarding-panel button')].find(b=>b.textContent==='Добавить домены').click();await wait(()=>window.fixtureDomainsApplied);await wait(()=>document.querySelector('.onboarding-panel').textContent.includes('Все домены SoundCloud уже добавлены'));
      await next();if(localStorage.getItem('soso_guitar_player')!=='false')throw Error('Preferences were applied before finishing');
      document.querySelector('.onboarding-panel [data-initial-focus]').click();await wait(()=>window.fixtureTourClosed===1);
      if(localStorage.getItem('soso_guitar_player')!=='true'||localStorage.getItem('soso_guitar_mode')!=='tabs'||localStorage.getItem('soso_find_clips')!=='true'||localStorage.getItem('soso_onboarding_completed')!=='true')throw Error('Completed tour did not save chosen settings');
      if(window.fixtureOverlayEnabled!==false||JSON.stringify(window.fixtureOverlayPreferenceCalls)!=='[false]')throw Error('Tour overlay choice not persisted');
      return {steps:12,missingTargetHandled:true,preferencesSaved:true,domainsAdded:true,overlayChoiceSaved:true};
    })()`);
      console.log('ONBOARDING_FLOW_OK ' + JSON.stringify(tourResult));
      const overviewMetrics = await window.webContents.executeJavaScript(`(async()=>{
      window.renderSettingsFixture();const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Settings wait timed out');};
      await wait(()=>document.querySelector('.settings-overview-columns'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const sections=[...document.querySelectorAll('.settings-overview-columns > section')];
      const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
      const columns=sections.map(section=>({heading:box(section.querySelector('h3')),rows:[...section.querySelectorAll('.settings-overview-row')].map(box),labels:[...section.querySelectorAll('.settings-overview-row-label')].map(box)}));
      if(Math.abs(columns[0].heading.width-columns[1].heading.width)>1)throw Error('Unequal overview columns');
      for(let i=0;i<2;i++){if(Math.abs(columns[0].rows[i].y-columns[1].rows[i].y)>1||Math.abs(columns[0].labels[i].y-columns[1].labels[i].y)>1)throw Error('Overview row alignment mismatch');}
      if(columns.some(c=>c.labels.some(label=>Math.abs(label.x-c.heading.x)>1)))throw Error('Overview title/label left padding mismatch');
      return columns;
    })()`);
      console.log('SETTINGS_OVERVIEW_ALIGNMENT_OK ' + JSON.stringify(overviewMetrics));
      fs.writeFileSync(
        path.join(screenshots, 'settings-overview.png'),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG(),
      );
      await window.webContents.executeJavaScript(`(async()=>{
      const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Session settings wait timed out');};
      [...document.querySelectorAll('.settings-tabs button')].find(b=>b.textContent==='Интеграции').click();
      await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Обновить сессию'));
      const getRefresh=()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Обновить сессию');
      const accountRow=getRefresh().closest('.settings-row');getRefresh().click();await wait(()=>!!window.fixtureFinishRefresh);
      await wait(()=>[...accountRow.querySelectorAll('button')].every(b=>b.disabled));
      window.fixtureFinishRefresh({connected:true,loginOpen:false});await wait(()=>!!getRefresh()&&!getRefresh().disabled);
      // Refresh invalidates cache; it does not prove that the provider can play a track.
      // Wait for the committed status and assert the precise guidance shown to the user.
      await wait(()=>document.querySelector('.settings-modal-content .settings-feedback[role="status"]')?.textContent==='Кэш сессии обновлён. Повторите запуск трека.');
      if(document.querySelector('.settings-modal-content .settings-feedback[role="status"]').classList.contains('error'))throw Error('Successful cache refresh shown as an error');
      if(window.fixtureRefreshChecks!==1)throw Error('Duplicate refresh request');
      getRefresh().click();await wait(()=>window.fixtureRefreshChecks===2);window.fixtureFinishRefresh({connected:true,loginOpen:false,error:'Вход сохранён, но YouTube не выдал поддерживаемый поток.'});
      await wait(()=>document.querySelector('.settings-feedback.error'));
      if(!getRefresh()||getRefresh().disabled)throw Error('Failed refresh removed the retry action or disconnected the account');
    })()`);
      await window.webContents.executeJavaScript(`(async()=>{
        const wait=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error('Overlay integration switch timed out');};
        const toggle=()=>document.querySelector('.overlay-integration-settings [role="switch"]');
        await wait(()=>toggle()&&!toggle().disabled);if(toggle().getAttribute('aria-checked')!=='false')throw Error('Saved overlay choice missing in integrations');
        toggle().click();await wait(()=>window.fixtureOverlayEnabled&&toggle().getAttribute('aria-checked')==='true');
        toggle().click();await wait(()=>!window.fixtureOverlayEnabled&&toggle().getAttribute('aria-checked')==='false');
        const original=window.electronAPI.setPlayerOverlayEnabled;window.electronAPI.setPlayerOverlayEnabled=async()=>{throw Error('write failed');};toggle().click();await wait(()=>document.querySelector('.overlay-integration-settings [role="alert"]'));if(toggle().getAttribute('aria-checked')!=='false')throw Error('Failed setting changed UI state');window.electronAPI.setPlayerOverlayEnabled=original;
      })()`);
      console.log('SETTINGS_SESSION_REFRESH_OK; OVERLAY_INTEGRATION_SWITCH_OK');
      await window.webContents.executeJavaScript(`(async()=>{
        const wait=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error('API settings did not load');};
        const tabs=()=>[...document.querySelectorAll('[role="tab"]')];
        if(document.querySelector('input[aria-label="Ключ API Last.fm"]'))throw Error('Key form remained in integrations');
        const forbidden=['Обложка и название трека поверх других окон. Клики проходят насквозь.','При отключении окно оверлея закрывается, его горячая клавиша освобождается. Управление музыкой продолжает работать.'];
        if(forbidden.some(text=>document.querySelector('.settings-modal-content').textContent.includes(text)))throw Error('Removed overlay help remains visible');
        tabs().find(tab=>tab.textContent==='API').click();
        await wait(()=>document.querySelector('.lastfm-key-settings input')&&!document.querySelector('.lastfm-key-settings button.settings-action-primary').disabled===false);
        const youtube=document.querySelector('input[aria-label="Ключ YouTube Data API"]');
        if(!youtube||!document.querySelector('input[aria-label="Ключ API Last.fm"]'))throw Error('Both key forms must share API tab');
        const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
        set(youtube,'fixture-youtube-key');await wait(()=>localStorage.getItem('soso_youtube_api_key')==='fixture-youtube-key');
        const lastfm=document.querySelector('input[aria-label="Ключ API Last.fm"]');set(lastfm,'a'.repeat(32));
        await wait(()=>!document.querySelector('.lastfm-key-settings .settings-action-primary').disabled);
        document.querySelector('.lastfm-key-settings .settings-action-primary').click();await wait(()=>document.querySelector('.lastfm-key-settings [role="status"]'));
        tabs().find(tab=>tab.textContent==='Воспроизведение').click();await wait(()=>document.querySelector('[aria-label="Искать клип"]'));
        if(document.querySelector('input[aria-label="Ключ YouTube Data API"]'))throw Error('YouTube key form remained in playback');
      })()`);
      console.log('API_SETTINGS_FORMS_OK');

      fs.writeFileSync(
        path.join(screenshots, 'settings-session-refresh.png'),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG(),
      );
      await window.webContents.executeJavaScript(
        '(async()=>{window.renderSettingsFixture();for(let i=0;i<100&&!document.querySelector(".settings-tabs");i++)await new Promise(r=>setTimeout(r,20));const tab=[...document.querySelectorAll(".settings-tabs button")].find(button=>button.textContent==="О приложении");if(!tab)throw Error("About tab missing");tab.click();for(let i=0;i<100&&!document.querySelector(".settings-about");i++)await new Promise(r=>setTimeout(r,20));const page=document.querySelector(".settings-about");if(!page.textContent.includes(window.fixtureAppVersion)||!page.textContent.includes("CatJAM223"))throw Error("About metadata mismatch");if(page.querySelector("a").href!=="https://github.com/CatJAM223/SoSo-Music")throw Error("Repository link mismatch");const button=page.querySelector("button");if(button.disabled||window.fixtureUpdateChecks)throw Error("Manual update button must be enabled");button.click();for(let i=0;i<100&&!page.querySelector("[role=status]");i++)await new Promise(r=>setTimeout(r,20));if(!page.textContent.includes("нет опубликованных релизов")||window.fixtureUpdateChecks!==1)throw Error("Manual check did not display the result");window.fixtureUpdateStatus={status:"available",currentVersion:"3.0.5",latestVersion:"3.1.0",releaseUrl:"https://github.com/CatJAM223/SoSo-Music/releases/tag/v3.1.0",message:"Доступна версия 3.1.0."};button.click();for(let i=0;i<100&&!page.querySelector(".settings-update-link");i++)await new Promise(r=>setTimeout(r,20));if(!page.querySelector(".settings-update-link"))throw Error("New release action missing");window.fixtureUpdateStatus={status:"error",currentVersion:"3.0.5",message:"Не удалось проверить обновления."};button.click();for(let i=0;i<100&&!page.querySelector(".settings-feedback.error");i++)await new Promise(r=>setTimeout(r,20));if(page.querySelector(".settings-update-link"))throw Error("Failed checks must not retain stale release actions");})()',
      );
      fs.writeFileSync(
        path.join(screenshots, 'settings-about.png'),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG(),
      );
      for (const [mode, width, height] of [
        ['dark', 1200, 800],
        ['light', 390, 844],
      ]) {
        window.setContentSize(width, height);
        await window.webContents.executeJavaScript(
          'document.documentElement.classList.toggle("dark",' +
            (mode === 'dark') +
            ');window.renderTourFixture()',
        );
        const metrics = await window.webContents.executeJavaScript(
          '(async()=>{for(let i=0;i<100&&!document.querySelector(".onboarding-panel");i++)await new Promise(r=>setTimeout(r,20));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const panel=document.querySelector(".onboarding-panel"),r=panel.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,background:getComputedStyle(panel).backgroundColor};})()',
        );
        assert.ok(
          metrics.left >= 0 && metrics.right <= metrics.width && metrics.bottom <= metrics.height,
        );
        assert.equal(
          metrics.background,
          mode === 'dark' ? 'rgb(20, 22, 25)' : 'rgb(247, 248, 248)',
        );
        assert.equal(
          await window.webContents.executeJavaScript(
            'getComputedStyle(document.querySelector(".onboarding-panel footer")).backgroundColor',
          ),
          'rgba(0, 0, 0, 0)',
          'Wallpaper must not turn onboarding actions into a player bar',
        );
        fs.writeFileSync(
          path.join(screenshots, 'onboarding-' + mode + '.png'),
          (
            await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
          ).toPNG(),
        );
        await window.webContents.executeJavaScript(
          'document.querySelector(".onboarding-panel .settings-close").click()',
        );
        await new Promise((r) => setTimeout(r, 30));
      }
      window.setContentSize(1200, 800);
      await window.webContents.executeJavaScript(
        'document.documentElement.classList.add("dark");window.renderAccessFixture()',
      );
      await window.webContents.executeJavaScript(
        '(async()=>{for(let i=0;i<100&&!window.fixtureAccountChanged;i++)await new Promise(r=>setTimeout(r,20));window.dispatchEvent(new CustomEvent("soso:youtube-access-issue",{detail:{reason:"verification-required",source:"clip",trackId:"yt_access001"}}));for(let i=0;i<100&&!document.querySelector(".youtube-access-panel");i++)await new Promise(r=>setTimeout(r,20));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()',
      );
      fs.writeFileSync(
        path.join(screenshots, 'youtube-account-hint.png'),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG(),
      );
      window.setContentSize(1200, 800);
      await window.webContents.executeJavaScript(
        'document.documentElement.classList.add("dark");window.renderLibraryTasteFixture()',
      );
      await window.webContents.executeJavaScript(`(async()=>{
        let step=0;const wait=async(fn)=>{step++;for(let attempt=0;attempt<100;attempt++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Last.fm UI timed out step '+step+' '+document.querySelector('.library-taste')?.textContent);};
        await wait(()=>document.querySelectorAll('.library-genre-sector').length===2);
        const panel=document.querySelector('.library-taste');
        if(!panel.textContent.includes('63%')||!panel.textContent.includes('nu metal'))throw Error('Stored library genres missing');
        if(panel.querySelector('h4').textContent!=='Last.fm')throw Error('Last.fm title must be concise');
        for(const removed of ['Вся медиатека','Обработано','Жанры найдены','Доли учитывают','Без жанров'])if(panel.textContent.includes(removed))throw Error('Removed text remains: '+removed);
        const stats=document.querySelector('.settings-stats-page');
        if(stats.getBoundingClientRect().bottom>panel.getBoundingClientRect().top)throw Error('Last.fm must follow main statistics');
        if(panel.querySelector('[role="tooltip"]'))throw Error('Track counts should be hidden until hover');
        const sector=panel.querySelector('.library-genre-sector');
        sector.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
        await wait(()=>panel.querySelector('[role="tooltip"]')?.textContent.includes('54 трека'));
        sector.dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));
        await wait(()=>!panel.querySelector('[role="tooltip"]'));
        const genreButton=panel.querySelectorAll('.library-taste-genres button')[1];genreButton.focus();
        // Offscreen Chromium moves activeElement but does not emit focusin for an inactive document.
        genreButton.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
        await wait(()=>panel.querySelector('[role="tooltip"]')?.textContent.includes('35 треков'));
        genreButton.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(()=>!panel.querySelector('[role="tooltip"]'));genreButton.blur();
        if(window.fixtureTasteStarts)throw Error('Viewing statistics started an analysis');
        const toggle=panel.querySelector('[role="switch"]');toggle.click();await wait(()=>toggle.getAttribute('aria-checked')==='true');
        const action=panel.querySelector('.library-taste-actions button');action.click();await wait(()=>panel.querySelector('progress'));
        if(window.fixtureTasteStarts!==1||!action.textContent.includes('Остановить'))throw Error('Analysis did not start exactly once');
        action.click();await wait(()=>!panel.querySelector('progress'));
        panel.scrollIntoView({block:'start'});
      })()`);
      fs.writeFileSync(
        path.join(screenshots, 'lastfm-library-taste.png'),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG(),
      );
      for (const width of [390, 1200]) {
        window.setContentSize(width, 844);
        await window.webContents.executeJavaScript(
          `(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const panel=document.querySelector('.library-taste'),container=document.querySelector('.settings-modal-content');if(container.scrollWidth>container.clientWidth+1)throw Error('Last.fm profile overflows '+JSON.stringify([...container.querySelectorAll('*')].filter(element=>element.getBoundingClientRect().right>container.getBoundingClientRect().right+1).slice(0,12).map(element=>({class:element.className,width:element.getBoundingClientRect().width,text:element.textContent.slice(0,50)}))));for(const element of panel.querySelectorAll('.library-genre-circle,.library-taste-genres')){if(element.getBoundingClientRect().right>panel.getBoundingClientRect().right+1)throw Error('Genre chart escapes panel');}})()`,
        );
      }
      for (const [width, dark] of [
        [1200, true],
        [1200, false],
        [390, true],
      ]) {
        window.setContentSize(width, 900);
        await window.webContents.executeJavaScript(`(async()=>{
          document.documentElement.classList.toggle('dark',${dark});window.renderLibraryTasteFixture('rich');
          for(let attempt=0;attempt<100&&document.querySelectorAll('.library-genre-sector').length!==12;attempt++)await new Promise(resolve=>setTimeout(resolve,20));
          const panel=document.querySelector('.library-taste');panel.scrollIntoView({block:'start'});
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const container=document.querySelector('.settings-modal-content');
          if(container.scrollWidth>container.clientWidth+1)throw Error('Full genre chart overflows at width ${width}');
          const sectors=[...panel.querySelectorAll('.library-genre-sector')];
          if(sectors.length!==12)throw Error('Full genre dataset failed to render');
          const percentages=[...panel.querySelectorAll('.library-taste-genres button > strong')].map(element=>parseInt(element.textContent,10));
          if(percentages.reduce((sum,value)=>sum+value,0)!==100)throw Error('Displayed percentages do not sum to 100');
          await new Promise(resolve=>setTimeout(resolve,350));
        })()`);
        fs.writeFileSync(
          path.join(
            screenshots,
            'lastfm-genres-' + width + '-' + (dark ? 'dark' : 'light') + '.png',
          ),
          (await window.webContents.capturePage()).toPNG(),
        );
      }
      await window.webContents.executeJavaScript(`(async()=>{
        const wait=async(fn)=>{for(let attempt=0;attempt<100;attempt++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Last.fm retry timed out');};
        window.renderLibraryTasteFixture('error');await wait(()=>document.querySelector('.library-taste [role="alert"]'));
        window.fixtureTasteMode='data';document.querySelector('.library-taste [role="alert"] button').click();await wait(()=>document.querySelector('.library-taste-genres'));
        window.renderLibraryTasteFixture('empty');await wait(()=>document.querySelector('.library-taste-empty'));
        if(document.querySelector('.library-taste-genres')||!document.querySelector('.library-taste-actions button').disabled)throw Error('Empty library shows invented genres');
      })()`);
      console.log(
        'LASTFM_LIBRARY_TASTE_UI_OK: stored genres, automatic setting, start/cancel, retry, empty library and responsive layout',
      );
      const localeResult = await window.webContents.executeJavaScript(`(async()=>{
        const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Locale fixture timed out');};
        window.renderSettingsFixture();await wait(()=>document.querySelector('.settings-overview'));
        if(document.querySelector('.settings-language'))throw Error('Language remains in Overview');
        [...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='Внешний вид').click();await wait(()=>document.querySelector('.settings-language'));
        const originalTrack=window.fixtureAudioState.currentTrack;
        document.querySelector('.settings-language button[lang="en"]').click();
        await wait(()=>document.querySelector('#desktop-settings-title').textContent==='Settings');
        if(localStorage.getItem('soso_language')!=='en'||document.documentElement.lang!=='en')throw Error('Language was not saved');
        if(window.fixtureAudioState.currentTrack!==originalTrack)throw Error('Language reset the player');
        const tabs=[...document.querySelectorAll('[role="tab"]')].map(e=>e.textContent);
        if(!tabs.includes('Appearance')||!tabs.includes('Integrations'))throw Error('Settings tabs stayed Russian');
        [...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='API').click();
        await wait(()=>document.querySelector('.lastfm-key-settings input') && document.querySelector('.lastfm-key-settings').textContent.includes('Key saved'));
        const keyPanel=document.querySelector('.lastfm-key-settings'), keyInput=keyPanel.querySelector('input');
        if(keyInput.value!==''||keyInput.type!=='password'||keyPanel.querySelector('a').href!=='https://www.last.fm/api/account/create')throw Error('Last.fm settings expose a key or lack the registration link');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(keyInput,'a'.repeat(32));keyInput.dispatchEvent(new Event('input',{bubbles:true}));
        await wait(()=>!keyPanel.querySelector('.settings-action-primary').disabled);keyPanel.querySelector('.settings-action-primary').click();
        await wait(()=>keyInput.value===''&&keyPanel.textContent.includes('saved on this computer'));
        window.renderTourFixture();await wait(()=>document.querySelector('#onboarding-title')?.textContent==='Welcome');
        if(document.querySelector('.onboarding-progress').getAttribute('aria-valuemax')!=='12')throw Error('Missing tour progress');
        document.querySelector('.onboarding-panel [data-initial-focus]').click();await wait(()=>document.querySelector('#onboarding-title').textContent==='Navigation and library');
        if(!document.querySelector('#onboarding-description').textContent.includes('playlists'))throw Error('Tour descriptions stayed Russian');
        window.renderWaveQueueFixture();await wait(()=>document.querySelector('.wave-control'));
        await new Promise(r=>setTimeout(r,650));
        const hiddenShapes=[...document.querySelectorAll('.wave-slice-shape')];
        if(hiddenShapes.length!==6||hiddenShapes.some(e=>getComputedStyle(e).opacity!=='0'))throw Error('Closed wave button leaks mode colours');
        const queueRect=document.querySelector('[data-queue-drawer]').getBoundingClientRect();if(innerWidth>=768&&(queueRect.top<43.5||queueRect.bottom>innerHeight-95.5))throw Error('Queue overlaps title or player bar');
        if(!document.body.textContent.includes('Next up (1)'))throw Error('Wave queue wraps already played tracks');
        if(!document.body.textContent.includes('Следующая песня')||!document.body.textContent.includes('Русский исполнитель'))throw Error('Music metadata was translated');
        if(document.body.textContent.includes('Queue repeat is on')||document.body.textContent.includes('On repeat'))throw Error('Repeat labels remain');
        document.querySelector('.wave-settings').click();await wait(()=>document.querySelector('.wave-control').dataset.settingsOpen==='true');
        if(!document.querySelector('.wave-slice-label').textContent.includes('Flow'))throw Error('Wave mode labels stayed Russian');
        document.querySelector('.wave-pizza-close').click();await wait(()=>document.querySelector('.wave-control').dataset.settingsOpen==='false');
        window.fixtureSetLocale('ru');return {persisted:true,trackPreserved:true,tourTranslated:true,announcedQueue:true,closedWaveUniform:true};
      })()`);
      console.log('LOCALE_WAVE_QUEUE_OK ' + JSON.stringify(localeResult));
      window.setContentSize(1200, 800);
      await window.webContents.executeJavaScript(
        `(async()=>{window.fixtureSetLocale('en');window.renderTourFixture();for(let i=0;i<100&&document.querySelector('#onboarding-title')?.textContent!=='Welcome';i++)await new Promise(r=>setTimeout(r,20));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`,
      );
      fs.writeFileSync(
        path.join(path.dirname(output), 'onboarding-en.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `(async()=>{window.renderWaveQueueFixture();await new Promise(r=>setTimeout(r,650));})()`,
      );
      fs.writeFileSync(
        path.join(path.dirname(output), 'wave-queue-en.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(`window.fixtureSetLocale('ru')`);

      await window.webContents.executeJavaScript(`(async()=>{
        let step=0;const wait=async(fn)=>{step++;for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Hotkey settings timed out step '+step+' '+document.querySelector('.settings-shortcuts')?.textContent);};
        window.fixtureSetupShortcuts();window.renderSettingsFixture();await wait(()=>document.querySelector('[role="tab"]'));
        [...document.querySelectorAll('[role="tab"]')].find(el=>el.textContent==='Горячие клавиши').click();
        const binding=()=>document.querySelector('[data-shortcut-action="overlay"]');
        await wait(()=>binding()?.querySelectorAll('kbd').length===3);
        if(document.querySelectorAll('.shortcuts-group').length!==2||document.querySelectorAll('.shortcut-keys kbd').length!==12)throw Error('Missing grouped keycaps');
        binding().click();await wait(()=>window.fixtureShortcutCapture&&binding().textContent.includes('Нажмите'));
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyO',ctrlKey:true,shiftKey:true,bubbles:true}));await wait(()=>binding().textContent==='CtrlShiftO');
        if(window.fixtureShortcutCalls[0].key!=='Control+Shift+O')throw Error('Hotkey not saved');
        binding().click();await wait(()=>window.fixtureShortcutCapture&&binding().textContent.includes('Нажмите'));window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',bubbles:true}));await wait(()=>!window.fixtureShortcutCapture);
        if(window.fixtureShortcutCalls.length!==1)throw Error('Cancel overwrote shortcut');
        const captureOriginal=window.electronAPI.captureDesktopShortcut;let finishCapture;
        window.electronAPI.captureDesktopShortcut=value=>value?new Promise(resolve=>{window.fixtureShortcutCapture=true;finishCapture=resolve;}):captureOriginal(false);
        binding().click();await wait(()=>!!finishCapture);window.dispatchEvent(new Event('blur'));finishCapture({shortcuts:{},unavailable:[],overlayEnabled:true});await new Promise(r=>setTimeout(r,40));
        if(window.fixtureShortcutCapture||binding().disabled||binding().textContent.includes('Нажмите'))throw Error('Late capture handshake resumed recording after blur');window.electronAPI.captureDesktopShortcut=captureOriginal;
        const menuButton=()=>binding().closest('.shortcut-row').querySelector('.shortcut-more');
        menuButton().click();await wait(()=>document.querySelector('.shortcut-menu'));document.querySelectorAll('.shortcut-menu button')[1].click();await wait(()=>binding().textContent==='Не назначено');
        if(window.fixtureShortcutCalls.at(-1).key!=='')throw Error('Disable menu failed');
        menuButton().click();await wait(()=>document.querySelector('.shortcut-menu'));document.querySelector('.shortcut-menu button').click();await wait(()=>binding().textContent==='CtrlShiftПробел');
        if(window.fixtureShortcutCalls.at(-1).key!=='Control+Shift+Space')throw Error('Reset menu failed');
        for (const sample of [{code:'F8',key:'F8',expected:'F8'},{code:'F8',key:'F8',shiftKey:true,expected:'Shift+F8'},{code:'Space',key:' ',ctrlKey:true,expected:'Control+Space'}]) {
          binding().click();await wait(()=>window.fixtureShortcutCapture&&binding().textContent.includes('Нажмите'));
          window.dispatchEvent(new KeyboardEvent('keydown',{...sample,bubbles:true}));await wait(()=>window.fixtureShortcutCalls.at(-1)?.key===sample.expected&&!window.fixtureShortcutCapture);
          await wait(()=>!binding().disabled);
        }
      })()`);
      fs.writeFileSync(
        path.join(path.dirname(output), 'shortcuts-dark.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        'document.documentElement.classList.remove("dark");window.fixtureSetLocale("en");',
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      fs.writeFileSync(
        path.join(path.dirname(output), 'shortcuts-light-en.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(`(async()=>{
        const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Overlay fixture timed out');};
        document.documentElement.classList.add('dark');window.fixtureSetLocale('ru');
        await wait(()=>[...document.querySelectorAll('[role="tab"]')].some(el=>el.textContent==='Интеграции'));
        if(document.querySelector('.shortcuts-position'))throw Error('Position control remained in shortcuts');
        if(document.querySelector('.settings-shortcuts').textContent.includes('Работают, даже когда плеер свёрнут.'))throw Error('Removed subtitle remained');
        [...document.querySelectorAll('[role="tab"]')].find(el=>el.textContent==='Интеграции').click();
        await wait(()=>document.querySelector('.overlay-position-row button')&&!document.querySelector('.overlay-position-row button').disabled);
        document.querySelector('.overlay-position-row button').click();await wait(()=>window.fixtureOverlayEditing);
        [...document.querySelectorAll('[role="tab"]')].find(el=>el.textContent==='Обзор').click();await wait(()=>!document.querySelector('.settings-shortcuts'));
        if(window.fixtureShortcutCapture)throw Error('Global shortcuts left suspended after tab close');
        window.fixtureOverlayEditing=false;window.renderOverlayFixture();await wait(()=>document.querySelector('.overlay-track strong')?.textContent==='Overlay song');
        if(document.querySelectorAll('[data-overlay-panel]').length!==1||document.querySelector('.player-overlay button'))throw Error('Viewing overlay has playback controls or handles');
        if(getComputedStyle(document.querySelector('.overlay-panel')).pointerEvents!=='none')throw Error('Track card intercepts clicks');
        if(getComputedStyle(document.querySelector('.overlay-panel')).backgroundColor!=='rgba(0, 0, 0, 0)')throw Error('Viewing overlay is not transparent');
        const title=document.querySelector('.overlay-track strong'),artist=document.querySelector('.overlay-track span'),info=document.querySelector('.overlay-track-info'),image=document.querySelector('.overlay-track img');
        const tr=title.getBoundingClientRect(),ar=artist.getBoundingClientRect();
        if(Math.abs(tr.left-ar.left)>.1||tr.bottom>ar.top)throw Error('Overlay title/artist lines are misaligned');
        if(getComputedStyle(info).paddingLeft!=='3px'||getComputedStyle(info).textShadow!=='none'||getComputedStyle(image).boxShadow!=='none')throw Error('Overlay padding/shadow regression');
        document.querySelector('.overlay-panel').dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
        if(document.querySelector('.overlay-grip'))throw Error('Hover activated overlay controls');
        window.fixtureOverlayEditing=true;window.fixtureOverlayModeListener(true);await wait(()=>document.querySelector('.overlay-grip'));
        document.querySelector('.overlay-track .overlay-grip').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await wait(()=>window.fixtureOverlayLayout.track.x>.04);
        const saved=window.fixtureOverlayLayout.track.x,oldListener=window.fixtureOverlayListener;window.renderOverlayFixture();await wait(()=>{if(!window.fixtureOverlayListener||window.fixtureOverlayListener===oldListener)return false;const r=document.querySelector('.overlay-track')?.getBoundingClientRect();return r&&document.querySelector('.overlay-grip')&&Math.abs(r.left-saved*(innerWidth-r.width))<1;});
        window.fixtureOverlayListener({...window.fixtureOverlayState,track:{...window.fixtureOverlayState.track,title:'New overlay song'},isPlaying:false});await wait(()=>document.querySelector('.overlay-track strong').textContent==='New overlay song');
      })()`);
      const dragPoint = await window.webContents.executeJavaScript(
        "(()=>{const r=document.querySelector('.overlay-track .overlay-grip').getBoundingClientRect();return {x:Math.round(r.left+30),y:Math.round(r.top+10)};})()",
      );
      await window.webContents.executeJavaScript(
        "window.fixturePointerLog=[];for(const name of ['pointerdown','pointermove','pointerup'])document.addEventListener(name,e=>window.fixturePointerLog.push({name,x:e.clientX,y:e.clientY,target:e.target.className}),{once:false});",
      );
      window.webContents.sendInputEvent({ type: 'mouseMove', ...dragPoint });
      await new Promise((resolve) => setTimeout(resolve, 40));
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        ...dragPoint,
        button: 'left',
        clickCount: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      window.webContents.sendInputEvent({
        type: 'mouseMove',
        x: dragPoint.x + 100,
        y: dragPoint.y - 35,
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      window.webContents.sendInputEvent({
        type: 'mouseUp',
        x: dragPoint.x + 100,
        y: dragPoint.y - 35,
        button: 'left',
        clickCount: 1,
      });
      await window.webContents.executeJavaScript(
        "(async()=>{for(let i=0;i<100;i++){if(window.fixtureOverlayLayout.track.x>.1)return;await new Promise(r=>setTimeout(r,20));}throw Error('Overlay mouse dragging failed '+JSON.stringify({layout:window.fixtureOverlayLayout,events:window.fixturePointerLog}));})()",
      );
      fs.writeFileSync(
        path.join(path.dirname(output), 'player-overlay.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(`(async()=>{
        document.querySelector('.overlay-done').click();
        for(let i=0;i<100&&document.querySelector('.overlay-done');i++)await new Promise(r=>setTimeout(r,20));
        if(document.querySelector('.player-overlay button')||window.fixtureOverlayEditing||getComputedStyle(document.querySelector('.overlay-panel')).pointerEvents!=='none')throw Error('Position editor did not return to click-through view');
        window.fixtureOverlayListener({...window.fixtureOverlayState,track:null});
        for(let i=0;i<100&&document.querySelector('.overlay-track');i++)await new Promise(r=>setTimeout(r,20));
        if(document.querySelector('.overlay-track'))throw Error('Empty overlay shows a waiting card');
        window.fixtureOverlayListener(window.fixtureOverlayState);
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 40));
      fs.writeFileSync(
        path.join(path.dirname(output), 'player-overlay-view.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(`(async()=>{
        document.documentElement.style.background='#fff';document.body.style.background='#fff';
        const left=document.querySelector('.overlay-track strong').getBoundingClientRect().left;
        window.fixtureOverlayListener({...window.fixtureOverlayState,track:{...window.fixtureOverlayState.track,id:'white-background',title:'Священная война',artist:{name:'Урал Гайсин'}}});
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const title=document.querySelector('.overlay-track strong').getBoundingClientRect(),artist=document.querySelector('.overlay-track span').getBoundingClientRect();
        if(Math.abs(title.left-left)>.1||Math.abs(title.left-artist.left)>.1||title.bottom>artist.top)throw Error('Changing metadata shifted the overlay text');
      })()`);
      fs.writeFileSync(
        path.join(path.dirname(output), 'player-overlay-white.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        "document.documentElement.style.background='transparent';document.body.style.background='transparent';",
      );
      await window.webContents.executeJavaScript(`(async()=>{
        const wait=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error('Overlay edge case timed out');};
        const save=window.electronAPI.saveOverlayLayout;
        window.fixtureOverlayEditing=true;window.fixtureOverlayModeListener(true);await wait(()=>document.querySelector('.overlay-done'));
        window.electronAPI.saveOverlayLayout=async()=>{throw Error('disk is full');};document.querySelector('.overlay-done').click();await wait(()=>document.querySelector('.overlay-error'));
        document.querySelector('.player-overlay').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));await wait(()=>!document.querySelector('.overlay-done'));
        if(window.fixtureOverlayEditing||getComputedStyle(document.querySelector('.overlay-panel')).pointerEvents!=='none')throw Error('Failed save trapped overlay input');window.electronAPI.saveOverlayLayout=save;
        const getLayout=window.electronAPI.getOverlayLayout;let resolveLayout;window.fixtureOverlayLayoutRequest=()=>new Promise(resolve=>resolveLayout=resolve);
        window.fixtureOverlayEditing=true;window.renderOverlayFixture();await wait(()=>document.querySelector('.overlay-done'));
        if(!document.querySelector('.overlay-done').disabled||document.querySelector('.overlay-grip'))throw Error('Editor can overwrite position before it loads');
        resolveLayout(structuredClone(window.fixtureOverlayLayout));await wait(()=>document.querySelector('.overlay-grip')&&!document.querySelector('.overlay-done').disabled);window.fixtureOverlayLayoutRequest=null;window.electronAPI.getOverlayLayout=getLayout;
        document.querySelector('.overlay-done').click();await wait(()=>!document.querySelector('.overlay-done'));
        const cover='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"/>');
        window.fixtureOverlayListener({...window.fixtureOverlayState,track:{...window.fixtureOverlayState.track,id:'artwork-recovery',album:{cover_medium:'https://artwork.invalid/overlay.jpg',cover_big:cover}}});await wait(()=>document.querySelector('.overlay-track img')?.naturalWidth===3);
        window.fixtureOverlayListener({...window.fixtureOverlayState,track:{...window.fixtureOverlayState.track,id:'no-artwork',album:{}}});await wait(()=>document.querySelector('.overlay-track img')?.getAttribute('src')===window.fixtureDefaultCover);
        let errors=0;document.querySelector('.overlay-track img').addEventListener('error',()=>errors++);document.querySelector('.overlay-track img').dispatchEvent(new Event('error'));await new Promise(r=>setTimeout(r,40));if(errors!==1)throw Error('Overlay placeholder retries itself');
      })()`);
      console.log(
        'PRE_PUSH_EDGE_CASES_OK: late shortcut handshake, failed position save/Esc, deferred position load and bounded artwork fallback',
      );
      console.log(
        'PLAYER_OVERLAY_SHORTCUTS_UI_OK: grouped keycaps, capture/cancel, transparent noninteractive view, position editor, mouse/keyboard move and saved position',
      );
      await window.webContents.executeJavaScript(`(async()=>{
        const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Update notification timed out');};
        const audio=new Audio();const bytes=new Uint8Array(44+44100*2*2),view=new DataView(bytes.buffer);const text=(offset,value)=>{for(let i=0;i<value.length;i++)bytes[offset+i]=value.charCodeAt(i);};text(0,'RIFF');view.setUint32(4,bytes.length-8,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,44100,true);view.setUint32(28,88200,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,bytes.length-44,true);audio.src=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));audio.volume=0;audio.muted=true;audio.loop=true;await audio.play();
        const originalTrack=window.fixtureAudioState.currentTrack;window.renderUpdateFixture();await wait(()=>window.fixtureUpdateListener);const before=audio.currentTime;
        window.fixtureUpdateListener({status:'available',currentVersion:'3.1.0',latestVersion:'3.2.0',message:'Available'});await wait(()=>document.querySelector('.app-update-notice'));
        if(document.querySelector('.app-update-notice').textContent.includes('Музыка продолжает играть')||document.querySelector('.app-update-notes')||!document.querySelector('.app-update-wave'))throw Error('Update notice ignores minimal design');
        const shade=document.querySelector('.app-update-shade').getBoundingClientRect();if(Math.abs(shade.top)>.5||Math.abs(shade.left)>.5||Math.abs(shade.right-innerWidth)>.5||Math.abs(shade.bottom-innerHeight)>.5)throw Error('Update backdrop does not cover the full window');
        const panel=document.querySelector('.app-update-notice').getBoundingClientRect();if(panel.top<44||panel.bottom>innerHeight-92)throw Error('Update notice covers title or player bar');if(panel.width>721||panel.height>481)throw Error('Update notice is not compact');
        await new Promise(r=>setTimeout(r,200));if(audio.paused||audio.currentTime<=before||window.fixtureAudioState.currentTrack!==originalTrack)throw Error('Update notice interrupted playback');
        const oldOpen=window.open;window.open=url=>{window.fixtureUpdateURL=url;return null;};document.querySelector('.app-update-download').click();await wait(()=>!document.querySelector('.app-update-notice'));window.open=oldOpen;
        if(window.fixtureUpdateURL!=='https://github.com/CatJAM223/SoSo-Music/releases/tag/v3.2.0')throw Error('Wrong update download target');
        window.fixtureUpdateListener({status:'available',currentVersion:'3.1.0',latestVersion:'3.2.0'});await new Promise(r=>setTimeout(r,30));if(document.querySelector('.app-update-notice'))throw Error('Dismissed version nags again');
        window.fixtureUpdateListener({status:'available',currentVersion:'3.1.0',latestVersion:'3.2.1'});await wait(()=>document.querySelector('.app-update-notice'));audio.pause();URL.revokeObjectURL(audio.src);
      })()`);
      fs.writeFileSync(
        path.join(path.dirname(output), 'update-notification.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      console.log(
        'LIVE_UPDATE_NOTICE_OK: arrives during playback, audio advances, minimal copy, stable dismissal and safe download link',
      );
      await window.webContents.executeJavaScript(`(async()=>{
        const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Queue redesign timed out');};
        window.renderRichQueueFixture();await wait(()=>document.querySelector('[data-queue-next]'));
        const row=document.querySelector('[data-queue-next]');row.querySelector('[role="button"]').click();if(window.fixtureQueuePlayCalls[0].wave!==true)throw Error('Queue selection exits My Wave');
        row.querySelector('.queue-more').click();await wait(()=>!row.querySelector('[role="menu"]').hidden);if(!row.querySelector('[role="menuitem"]')||row.querySelector('.queue-track-info').getBoundingClientRect().width<160)throw Error('Queue actions squeeze track metadata');
        row.querySelector('.queue-more').click();await wait(()=>row.querySelector('[role="menu"]').hidden);
        await wait(()=>Math.abs(document.querySelector('[data-queue-drawer]').getBoundingClientRect().top-44)<.5);const rect=document.querySelector('[data-queue-drawer]').getBoundingClientRect();if(Math.abs(rect.top-44)>.5||rect.bottom>innerHeight-95.5)throw Error('Queue geometry differs from window bars');
      })()`);
      fs.writeFileSync(
        path.join(path.dirname(output), 'queue-redesign.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      console.log(
        'QUEUE_REDESIGN_OK: title/player bounds, readable metadata, track menu and preserved wave selection',
      );
      assert.deepEqual(errors, [], 'React renderer must not throw');
      reportProgress('passed');
      clearTimeout(timeout);
      window.destroy();
      app.quit();
    } catch (error) {
      reportProgress('failed');
      console.error(error);
      app.exit(1);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
