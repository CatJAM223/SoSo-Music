const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
// Use a reduced-motion baseline to catch accidental resets of explicit media emulation.
app.commandLine.appendSwitch('force-prefers-reduced-motion', 'reduce');
const output = path.resolve(process.argv[2]);
app.setPath('userData', path.join(output, 'profile'));
app.setPath('sessionData', path.join(output, 'profile'));
let activeStage = 'startup';
const deadline = setTimeout(() => {
  console.error('UI interactions timed out during ' + activeStage);
  app.exit(1);
}, 55000);
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const external = [];
  session.defaultSession.webRequest.onBeforeRequest((details, reply) => {
    const allowed = /^(file|data|blob|devtools):/.test(details.url);
    if (!allowed) external.push(details.url);
    reply({ cancel: !allowed });
  });
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 800,
    useContentSize: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  // An idle offscreen compositor may not schedule a second RAF. Keep real
  // frames flowing only while the renderer test asks for them, and bound hangs.
  for (const [method, budgetMs] of [
    ['executeJavaScript', 10000],
    ['capturePage', 5000],
  ]) {
    const invoke = win.webContents[method].bind(win.webContents);
    win.webContents[method] = async (...args) => {
      activeStage =
        method +
        ' ' +
        (typeof args[0] === 'string' ? args[0].replace(/\s+/g, ' ').slice(0, 100) : 'snapshot');
      let timer, frames;
      try {
        if (method === 'executeJavaScript' && args[0].includes('requestAnimationFrame'))
          frames = setInterval(() => win.webContents.invalidate(), 16);
        win.webContents.invalidate();
        return await Promise.race([
          invoke(...args),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(Error('UI operation timed out after ' + budgetMs + 'ms: ' + activeStage)),
              budgetMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
        clearInterval(frames);
      }
    };
  }
  const errors = [];
  win.webContents.on('console-message', (_, level, message) => {
    if (level === 3) errors.push(message);
  });
  try {
    await win.loadFile(path.join(output, 'index.html'));
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    assert.equal(
      await win.webContents.executeJavaScript(
        'matchMedia("(prefers-reduced-motion: reduce)").matches',
      ),
      false,
      'Animation checks require the explicitly selected no-preference mode',
    );
    await win.webContents.executeJavaScript(
      'document.documentElement.classList.add("dark");document.documentElement.dataset.theme="default";document.documentElement.style.setProperty("--theme-accent","#eab308");document.documentElement.style.setProperty("--theme-accent-rgb","234, 179, 8");',
    );
    for (const [layout, width, height] of [['desktop', 1100, 800]]) {
      win.setContentSize(width, height);
      const result = await win.webContents.executeJavaScript(
        '(' +
          async function (layout) {
            const tick = () =>
              new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
            const until = async (predicate, message = 'UI condition timed out') => {
              for (let i = 0; i < 150; i++) {
                if (predicate()) return;
                await new Promise((done) => setTimeout(done, 10));
              }
              throw Error(message);
            };
            window.showFixture(layout);
            await until(() => document.querySelectorAll('[data-track-id]').length === 2);
            await tick();
            const row = (id) => document.querySelector('[data-track-id="' + id + '"]');
            [...row('sc_1').querySelectorAll('div')]
              .find((el) => el.childElementCount === 0 && el.textContent === 'First')
              .click();
            await tick();
            if (window.actions.join(',') !== 'play:sc_1')
              throw Error('Title dispatched duplicate playback: ' + window.actions);
            // React state and the CSS background transition commit independently. Two
            // RAFs do not guarantee the first nontransparent transition sample.
            const hasLoadingState = () =>
              row('sc_1').dataset.playbackState === 'loading' &&
              row('sc_1').getAttribute('aria-busy') === 'true' &&
              !!row('sc_1').querySelector('.animate-spin');
            await until(hasLoadingState, 'Loading is not visible on selected row');
            if (!hasLoadingState()) throw Error('Loading is not visible on selected row');
            await until(
              () => getComputedStyle(row('sc_1')).backgroundColor !== 'rgba(0, 0, 0, 0)',
              'Loading row has no visual highlight',
            );
            if (getComputedStyle(row('sc_1')).backgroundColor === 'rgba(0, 0, 0, 0)')
              throw Error('Loading row has no visual highlight');
            row('sc_2').click();
            await tick();
            if (
              row('sc_1').dataset.playbackState === 'loading' ||
              row('sc_2').dataset.playbackState !== 'loading'
            )
              throw Error('Old row retained loading state');
            row('sc_2').querySelector('button[aria-label^="Отменить загрузку"]').click();
            await tick();
            if (
              window.actions.at(-1) !== 'toggle' ||
              row('sc_2').dataset.playbackState !== 'paused'
            )
              throw Error('Loading click did not cancel once');
            row('sc_2').click();
            await tick();
            if (
              window.actions.at(-1) !== 'toggle' ||
              row('sc_2').dataset.playbackState !== 'playing' ||
              window.actions.filter((a) => a.startsWith('play:')).length !== 2
            )
              throw Error('Paused current track restarted instead of resuming');
            const visibleMetadata = () =>
              [...document.querySelectorAll('.soso-track-enter')].find(
                (el) => el.getBoundingClientRect().height > 0,
              );
            const original = visibleMetadata();
            window.updateFixture({
              currentTrack: window.tracks[0],
              isPlaying: true,
              isLoadingTrack: false,
            });
            await tick();
            const changed = visibleMetadata();
            if (
              original === changed ||
              !changed.textContent.includes('First') ||
              getComputedStyle(changed).animationName !== 'sosoTrackEnter'
            )
              throw Error('Metadata did not get a short track transition');
            window.updateFixture({ volume: 0.25 });
            await tick();
            if (visibleMetadata() !== changed)
              throw Error('Unrelated state replays track transition');
            const image = [...document.querySelectorAll('.soso-art-enter')].find(
              (el) => el.getBoundingClientRect().height > 0,
            );
            image.style.display = 'none';
            window.updateFixture({ currentTrack: window.tracks[1] });
            await tick();
            const restored = [...document.querySelectorAll('.soso-art-enter')].find(
              (el) => el.getBoundingClientRect().height > 0,
            );
            if (!restored || restored.style.display === 'none')
              throw Error('Broken previous artwork hid the new cover');
            if (document.documentElement.scrollWidth > innerWidth + 1)
              throw Error('Horizontal overflow');
            window.showFixture(layout, 'wave');
            await until(() => document.querySelector('button[aria-label="Включить волну"]'));
            document.querySelector('button[aria-label="Включить волну"]').click();
            await tick();
            const pending = document.querySelector('button[aria-label="Отменить загрузку волны"]');
            if (!pending || pending.disabled || pending.getAttribute('aria-busy') !== 'true')
              throw Error('Wave has no cancellable immediate loading response');
            if (!pending.textContent.includes('Подбираю трек'))
              throw Error('Wave state is not explained');
            pending.click();
            await tick();
            if (window.actions.join(',') !== 'wave:default,stop-wave')
              throw Error('Wave cancellation is not wired');
            window.showFixture(layout);
            await tick();
            window.updateFixture({ currentTrack: window.tracks[0], isLoadingTrack: true });
            await tick();
            const cancel = [
              ...document.querySelectorAll('button[aria-label="Отменить загрузку"]'),
            ].find((el) => el.getBoundingClientRect().height > 0);
            if (!cancel || cancel.disabled) throw Error('Player loading control is inert');
            cancel.click();
            await tick();
            if (window.actions.at(-1) !== 'toggle') throw Error('Player did not dispatch cancel');
            return {
              layout,
              singleTitleAction: true,
              localLoading: true,
              resume: true,
              cancel: true,
              metadata: true,
              artworkRecovery: true,
              waveCancel: true,
            };
          }.toString() +
          ')(' +
          JSON.stringify(layout) +
          ')',
      );
      console.log('UI_INTERACTIONS_OK ' + JSON.stringify(result));
      await win.webContents.executeJavaScript(
        'window.updateFixture({currentTrack:window.tracks[1],isLoadingTrack:true});new Promise(done=>setTimeout(done,200));',
      );
      fs.writeFileSync(
        path.join(path.dirname(output), 'ui-response-' + layout + '.png'),
        (
          await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG(),
      );
    }
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true,
    });
    // Exercise the actual Discover view and real pointer hit-testing of the morphing slices.
    await win.webContents.executeJavaScript(
      '(async()=>{window.showFixture("desktop","wave");for(let i=0;i<150&&!document.querySelector(".wave-settings");i++)await new Promise(r=>setTimeout(r,10));await new Promise(r=>setTimeout(r,450));})()',
    );
    fs.writeFileSync(
      path.join(path.dirname(output), 'wave-redesign-closed.png'),
      (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG(),
    );
    const morphChecks = await win.webContents.executeJavaScript(
      '(' +
        async function () {
          const frame = () => new Promise(requestAnimationFrame),
            wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const circle = document.querySelector('.wave-pizza'),
            gear = document.querySelector('.wave-settings'),
            hero = document.querySelector('.wave-hero');
          const rect = () => circle.getBoundingClientRect(),
            before = rect();
          const stage = document.querySelector('.wave-control-stage'),
            beforeStage = stage.getBoundingClientRect();
          const title = document.querySelector('.wave-control-heading').getBoundingClientRect();
          if (document.querySelector('.wave-launch-caption'))
            throw Error('Idle wave still has a caption');
          if (
            beforeStage.height > 241 ||
            before.top - title.bottom > 35 ||
            gear.getBoundingClientRect().top - before.bottom > 40
          )
            throw Error('Closed wave has excessive empty space');
          window.updateFixture({
            isWaveActive: true,
            currentTrack: window.tracks[0],
            isPlaying: true,
          });
          await wait(30);
          if (
            document.querySelector('.wave-launch-caption') ||
            !document.querySelector('.wave-launch-icon')
          )
            throw Error('Playing wave still has a caption');
          window.updateFixture({ isPlaying: false });
          await wait(30);
          if (
            getComputedStyle(hero).backgroundColor !== 'rgba(0, 0, 0, 0)' ||
            getComputedStyle(hero).backgroundImage !== 'none' ||
            parseFloat(getComputedStyle(hero).borderTopWidth) !== 0
          )
            throw Error('Wave still has a background card');
          if (
            document.querySelector('.wave-control-orbit') ||
            document.querySelector('.wave-control-heading p')
          )
            throw Error('Unwanted decoration remains');
          gear.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
          await frame();
          await wait(180);
          const during = rect();
          if (!(during.width > before.width + 2 && during.width < 264))
            throw Error('Disc does not interpolate into the pizza ' + during.width);
          const stageGrowth = stage.getBoundingClientRect().height - beforeStage.height;
          if (
            Math.abs(during.x + during.width / 2 - before.x - before.width / 2) > 1 ||
            Math.abs(
              during.y + during.height / 2 - before.y - before.height / 2 - stageGrowth / 2,
            ) > 1
          )
            throw Error('Disc jumps independently of the expanding layout');
          await wait(450);
          const open = rect();
          gear.click();
          await frame();
          await wait(180);
          const closing = rect();
          if (!(closing.width > before.width + 2 && closing.width < open.width))
            throw Error('Disc does not interpolate back');
          await wait(450);
          if (
            document.querySelector('.wave-pizza') !== circle ||
            getComputedStyle(document.querySelector('.wave-launch')).visibility !== 'visible'
          )
            throw Error('Morph replaced the disc or lost the play control');
          return {
            sharedDisc: true,
            openingAndClosing: true,
            centreTracksLayout: true,
            compactClosed: true,
            iconOnly: true,
            backgroundRemoved: true,
          };
        }.toString() +
        ')()',
    );
    console.log('WAVE_DISC_MORPH_OK ' + JSON.stringify(morphChecks));
    const waveChecks = await win.webContents.executeJavaScript(
      '(' +
        async function () {
          const wait = () => new Promise((r) => setTimeout(r, 600));
          const gear = () => document.querySelector('.wave-settings');
          gear().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
          await wait();
          const circle = document.querySelector('.wave-pizza'),
            rect = circle.getBoundingClientRect();
          const pieces = [...document.querySelectorAll('[data-wave-slice]')];
          if (pieces.length !== 6 || window.actions.length)
            throw Error('Settings must expose five modes and reset without starting playback');
          const reset = document.querySelector('[data-wave-slice="reset"]');
          if (
            reset.parentElement !== circle ||
            parseFloat(reset.style.getPropertyValue('--slice-label-y')) < 80
          )
            throw Error('Reset is not the bottom pizza slice');
          const selected = document.querySelector('[data-selected="true"]');
          if (
            getComputedStyle(selected.querySelector('.wave-slice-shape')).backgroundColor !==
            'rgb(234, 179, 8)'
          )
            throw Error('Selected slice ignores theme accent');
          document.documentElement.style.setProperty('--theme-accent', '#06b6d4');
          document.documentElement.style.setProperty('--theme-accent-rgb', '6, 182, 212');
          await wait();
          // The registered mood colour and background colour animate in succession.
          // Await the actual result while keeping the offscreen compositor producing frames.
          const themeDeadline = performance.now() + 2000;
          while (
            getComputedStyle(selected.querySelector('.wave-slice-shape')).backgroundColor !==
            'rgb(6, 182, 212)'
          ) {
            if (performance.now() >= themeDeadline)
              throw Error('Theme change did not update selection');
            await new Promise(requestAnimationFrame);
          }
          const energy = document.querySelector('[data-wave-slice="energy"]');
          energy.focus();
          await wait();
          if (
            energy.dataset.preview !== 'true' ||
            getComputedStyle(energy.querySelector('.wave-slice-description')).visibility !==
              'visible'
          )
            throw Error(
              'Keyboard focus did not reveal the explanation ' +
                JSON.stringify({
                  preview: energy.dataset.preview,
                  visibility: getComputedStyle(energy.querySelector('.wave-slice-description'))
                    .visibility,
                  active: document.activeElement.outerHTML.slice(0, 250),
                  root: document.querySelector('.wave-control').dataset.settingsOpen,
                }),
            );
          energy.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
          if (document.activeElement.dataset.waveSlice !== 'discover')
            throw Error('Arrow navigation is broken');
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await wait();
          if (gear().getAttribute('aria-expanded') !== 'false' || document.activeElement !== gear())
            throw Error('Escape did not restore settings focus');
          gear().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
          await wait();
          energy.click();
          await wait();
          if (
            window.actions.join(',') !== 'wave:energy' ||
            gear().getAttribute('aria-expanded') !== 'false'
          )
            throw Error('Mode selection must start once and close the pizza');
          gear().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
          await wait();
          if (!reset.disabled) throw Error('Loading allows duplicate reset');
          window.updateFixture({ isWaveStarting: false, isLoadingTrack: false, isPlaying: true });
          await wait();
          if (document.querySelector('[data-selected="true"]').dataset.waveSlice !== 'energy')
            throw Error('Chosen mode was not highlighted');
          reset.click();
          await wait();
          if (window.actions.join(',') !== 'wave:energy,wave:energy')
            throw Error('Reset did not rebuild the current mode');
          window.updateFixture({ isWaveStarting: false, isLoadingTrack: false, isPlaying: true });
          await wait();
          gear().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
          await wait();
          document.activeElement.blur();
          const target = document.querySelector('[data-wave-slice="chill"]'),
            r = circle.getBoundingClientRect();
          return {
            x:
              r.left +
              (r.width * parseFloat(target.style.getPropertyValue('--slice-label-x'))) / 100,
            y:
              r.top +
              (r.height * parseFloat(target.style.getPropertyValue('--slice-label-y'))) / 100,
            closedLaunch: true,
            sixSlices: true,
            resetAtBottom: true,
            themeReactive: true,
            keyboard: true,
            selectAndReset: true,
          };
        }.toString() +
        ')()',
    );
    const sourceChecks = await win.webContents.executeJavaScript(
      '(' +
        async function () {
          const panel = document.querySelector('.wave-sources'),
            circle = document.querySelector('.wave-pizza');
          const panelRect = panel.getBoundingClientRect(),
            circleRect = circle.getBoundingClientRect();
          if (panelRect.left < circleRect.right + 16)
            throw Error('Source panel must appear to the right of the circle');
          if (panel.querySelector('.wave-source-detail') || panel.textContent.includes('Только'))
            throw Error('Source subtitles must be removed');
          for (const source of ['youtube', 'soundcloud']) {
            const brand = panel.querySelector(
              '[data-wave-source="' + source + '"] [data-brand="' + source + '"]',
            );
            if (!brand) throw Error('Missing platform brand icon: ' + source);
            if (brand.tagName === 'IMG' && (!brand.complete || !brand.naturalWidth))
              throw Error('Platform icon failed to load');
          }
          for (const source of ['youtube', 'soundcloud', 'all']) {
            document.querySelector('[data-wave-source="' + source + '"]').click();
            await new Promise((resolve) => setTimeout(resolve, 20));
            if (
              document
                .querySelector('[data-wave-source="' + source + '"]')
                .getAttribute('aria-pressed') !== 'true'
            )
              throw Error('Source selection was not reflected');
            if (panel.getAttribute('aria-hidden') !== 'false')
              throw Error('Source selection closed the panel');
          }
          return { rightPanel: true, allThreeChoices: true };
        }.toString() +
        ')()',
    );
    console.log('WAVE_SOURCES_OK ' + JSON.stringify(sourceChecks));
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    await win.webContents.executeJavaScript('new Promise(r=>setTimeout(r,450))');
    fs.writeFileSync(
      path.join(path.dirname(output), 'wave-redesign-open.png'),
      (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG(),
    );
    win.webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.round(waveChecks.x),
      y: Math.round(waveChecks.y),
    });
    await win.webContents.executeJavaScript(
      '(async()=>{await new Promise(r=>setTimeout(r,500));const b=document.querySelector(\'[data-wave-slice="chill"]\');if(b.dataset.preview!=="true")throw Error("Real pointer did not reveal slice");const shape=b.querySelector(".wave-slice-shape");if(getComputedStyle(shape).transform==="none")throw Error("Slice did not move out");})()',
    );
    fs.writeFileSync(
      path.join(path.dirname(output), 'wave-redesign-hover.png'),
      (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG(),
    );
    const crop = await win.webContents.executeJavaScript(
      '(()=>{const r=document.querySelector(".wave-hero").getBoundingClientRect();return{x:Math.round(r.left+r.width/2-230),y:Math.ceil(r.top+1),width:460,height:Math.floor(r.height-2)};})()',
    );
    fs.writeFileSync(
      path.join(path.dirname(output), 'wave-redesign-preview.png'),
      (await win.webContents.capturePage(crop, { stayHidden: true, stayAwake: true })).toPNG(),
    );
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const layoutChecks = await win.webContents.executeJavaScript(
      '(' +
        async function () {
          const wait = () => new Promise((r) => setTimeout(r, 50)),
            main = document.querySelector('main');
          const results = [];
          for (const dark of [true, false])
            for (const width of [360, 420]) {
              document.documentElement.classList.toggle('dark', dark);
              main.style.maxWidth = width + 'px';
              main.style.margin = '0 auto';
              await wait();
              const root = document.querySelector('.wave-control').getBoundingClientRect();
              const stage = document.querySelector('.wave-control-stage').getBoundingClientRect();
              for (const button of document.querySelectorAll('[data-wave-slice]')) {
                button.focus();
                await wait();
                const card = button.querySelector('.wave-slice-copy').getBoundingClientRect();
                const desc = button
                  .querySelector('.wave-slice-description')
                  .getBoundingClientRect();
                if (card.left < root.left - 1 || card.right > root.right + 1)
                  throw Error(
                    'Expanded mode card escapes narrow layout ' +
                      width +
                      ' ' +
                      button.dataset.waveSlice,
                  );
                if (card.top < stage.top - 1 || card.bottom > stage.bottom + 1)
                  throw Error('Mode card overlaps heading or settings ' + button.dataset.waveSlice);
                const action = button.querySelector('.wave-slice-action').getBoundingClientRect();
                if (
                  action.bottom > card.bottom - 7 ||
                  action.right > card.right - 7 ||
                  desc.bottom > action.top - 2
                )
                  throw Error(
                    'Mode contents escape square ' +
                      button.dataset.waveSlice +
                      ' ' +
                      JSON.stringify({
                        width,
                        dark,
                        waveSize: getComputedStyle(
                          document.querySelector('.wave-control'),
                        ).getPropertyValue('--wave-size'),
                        card: { x: card.x, y: card.y, width: card.width, height: card.height },
                        desc: { bottom: desc.bottom, height: desc.height },
                        action: { top: action.top, bottom: action.bottom, right: action.right },
                      }),
                  );
                if (
                  parseFloat(
                    getComputedStyle(button.querySelector('.wave-slice-description')).fontSize,
                  ) < 12
                )
                  throw Error('Explanation text is too small');
                if (
                  !/^rgb\(/.test(
                    getComputedStyle(button.querySelector('.wave-slice-shape')).backgroundColor,
                  )
                )
                  throw Error('Explanation background is translucent');
                if (desc.bottom > card.bottom - 7)
                  throw Error(
                    'Mode explanation is clipped ' + width + ' ' + button.dataset.waveSlice,
                  );
              }
              const sourcePanel = document.querySelector('.wave-sources').getBoundingClientRect();
              const circle = document.querySelector('.wave-pizza').getBoundingClientRect();
              if (
                sourcePanel.left < root.left ||
                sourcePanel.right > root.right ||
                sourcePanel.top < circle.bottom + 12
              )
                throw Error('Source panel escapes or overlaps narrow layout');
              results.push({ dark, width, allSixExplanationsFit: true, sourcePanelFits: true });
            }
          main.style.maxWidth = '';
          main.style.margin = '';
          document.documentElement.classList.add('dark');
          document.activeElement.blur();
          await wait();
          return results;
        }.toString() +
        ')()',
    );
    console.log('WAVE_RADIAL_LAYOUT_OK ' + JSON.stringify(layoutChecks));
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });

    // Keep original hit area active through the morph, even near the circle's centre.
    const innerPoint = await win.webContents.executeJavaScript(
      '(()=>{const r=document.querySelector(".wave-pizza").getBoundingClientRect();return{x:r.left+r.width*.42,y:r.top+r.height*.45};})()',
    );
    win.webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.round(innerPoint.x),
      y: Math.round(innerPoint.y),
    });
    await win.webContents.executeJavaScript(
      '(async()=>{await new Promise(r=>setTimeout(r,500));if(document.querySelector(\'[data-wave-slice="chill"]\').dataset.preview!=="true")throw Error("Morph lost its original hit area");})()',
    );
    await win.webContents.executeJavaScript(
      'document.querySelector("#press-target").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));new Promise(r=>setTimeout(r,450))',
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        'document.querySelector(".wave-settings").getAttribute("aria-expanded")',
      ),
      'false',
    );
    console.log('WAVE_RADIAL_UI_OK ' + JSON.stringify(waveChecks));
    await win.webContents.executeJavaScript(
      'window.showFixture("desktop");window.updateFixture({currentTrack:window.tracks[0]});new Promise(r=>setTimeout(r,300))',
    );

    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: false,
    });
    const rect = await win.webContents.executeJavaScript(
      '(()=>{const b=document.querySelector("#press-target"),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,duration:getComputedStyle(b).transitionDuration};})()',
    );
    assert.match(rect.duration, /0.14s/);
    win.webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.round(rect.x),
      y: Math.round(rect.y),
    });
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      button: 'left',
      clickCount: 1,
    });
    const pressedScale = await win.webContents.executeJavaScript(
      '(async()=>{const deadline=performance.now()+1000;let scale;do{scale=getComputedStyle(document.querySelector("#press-target")).scale;if(scale==="0.97")return scale;await new Promise(requestAnimationFrame);}while(performance.now()<deadline);return scale;})()',
    );
    assert.equal(pressedScale, '0.97');
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      button: 'left',
      clickCount: 1,
    });
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const reduced = await win.webContents.executeJavaScript(
      'getComputedStyle(document.querySelector(".soso-track-enter")).animationDuration',
    );
    assert.ok(parseFloat(reduced) <= 0.001, reduced);
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    win.webContents.debugger.detach();
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      'UI_PRESS_AND_REDUCED_MOTION_OK ' +
        JSON.stringify({ externalRequests: external.length, errors: errors.length }),
    );
    win.destroy();
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error(error, errors);
    win.destroy();
    clearTimeout(deadline);
    app.exit(1);
  }
});
