const { app, BrowserWindow, session } = require('electron');
const path = require('node:path'),
  assert = require('node:assert/strict');
const output = path.resolve(process.argv[2]);
app.setPath('userData', path.join(output, 'profile'));
app.setPath('sessionData', path.join(output, 'profile'));
const deadline = setTimeout(() => app.exit(1), 25000);
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
    height: 900,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (_, level, message) => {
    if (level === 3) errors.push(message);
  });
  try {
    await win.loadFile(path.join(output, 'index.html'));
    for (const layout of ['desktop'])
      for (const strict of [false, true]) {
        let rendererDeadline;
        const result = await Promise.race([
          win.webContents.executeJavaScript(
            '(' +
              async function (layout, strict) {
                const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
                const check = (condition, message) => {
                  if (!condition) throw Error(layout + ' strict=' + strict + ': ' + message);
                };
                const until = async (predicate) => {
                  for (let i = 0; i < 80; i++) {
                    if (predicate()) return;
                    await new Promise((resolve) => setTimeout(resolve, 10));
                  }
                  throw Error('Settings UI timed out');
                };
                const f = window.settingsFixture;
                const listeners = () => ({
                  stats: f.statsListeners.size,
                  account: f.accountListeners.size,
                  offline: f.offlineListeners.size,
                  lan: f.lanListeners.size,
                  intervals: f.intervals.size,
                });
                const tab = (label) => {
                  const button = [...document.querySelectorAll('.settings-tabs button')].find(
                    (el) => el.textContent === label,
                  );
                  check(button, 'Tab missing: ' + label);
                  button.click();
                };
                const statsVisible = () => document.querySelector('.settings-stats-summary');
                const renderedPlays = () =>
                  Number(statsVisible()?.children[1]?.querySelector('strong')?.textContent);
                window.mountSettings(layout, strict);
                await until(() => document.querySelector('[role="dialog"]'));
                await tick();
                const expectedMount = f.statsReads;
                check(
                  layout === 'desktop'
                    ? expectedMount >= 1 && expectedMount <= (strict ? 2 : 1)
                    : expectedMount === 0,
                  'Mount statistics count: ' + expectedMount,
                );
                check(
                  f.statsListeners.size === (layout === 'desktop' ? 1 : 0),
                  'Mount stats listener count',
                );
                check(
                  f.accountListeners.size === (layout === 'desktop' ? 1 : 0),
                  'Account subscriptions duplicated',
                );
                check(
                  f.offlineListeners.size === (layout === 'desktop' ? 1 : 0),
                  'Offline subscriptions duplicated',
                );
                check(
                  f.lanListeners.size === (layout === 'desktop' ? 1 : 0),
                  'LAN subscriptions duplicated',
                );
                check(
                  f.intervals.size === (layout === 'desktop' ? 1 : 0),
                  'LAN polling timer duplicated',
                );
                const afterMount = {
                  stats: f.statsReads,
                  history: f.historyReads,
                  cache: f.cacheReads,
                  lan: f.lanReads,
                };
                for (let i = 0; i < 3; i++) {
                  window.rerenderSettings();
                  await tick();
                }
                check(
                  JSON.stringify(afterMount) ===
                    JSON.stringify({
                      stats: f.statsReads,
                      history: f.historyReads,
                      cache: f.cacheReads,
                      lan: f.lanReads,
                    }),
                  'Unrelated rerender repeated service reads',
                );
                tab('Воспроизведение');
                await tick();
                check(
                  !document.querySelector('.library-taste'),
                  'Last.fm should be inside statistics',
                );
                check(f.intervals.size === 1, 'Audio tab must not own removed neural polling');
                tab('Статистика');
                await until(
                  () =>
                    statsVisible() &&
                    document.querySelector('.library-taste [role="switch"]:not(:disabled)'),
                );
                await tick();
                const analysisSwitch = document.querySelector(
                  '[aria-label="Автоматически анализировать новые треки"]',
                );
                check(
                  analysisSwitch.getAttribute('aria-checked') === 'true',
                  'Automatic analysis must show saved state',
                );
                check(
                  document.querySelector('.library-taste h4').textContent === 'Last.fm',
                  'Last.fm title must stay concise',
                );
                analysisSwitch.click();
                await tick();
                check(
                  analysisSwitch.getAttribute('aria-checked') === 'false' &&
                    f.autoAnalyze === false,
                  'Automatic analysis setting must persist',
                );
                check(
                  f.intervals.size === 1,
                  'Last.fm status must not add overlapping interval pollers',
                );
                check(
                  f.statsReads === expectedMount + 1,
                  'Entering stats must issue exactly one request',
                );
                check(f.statsListeners.size === 1, 'Active stats tab owns exactly one listener');
                check(
                  renderedPlays() === f.statsReads,
                  'Actual stats UI did not receive service result',
                );
                const current = f.statsReads;
                window.rerenderSettings();
                await tick();
                check(f.statsReads === current, 'Stats rerender repeated request');
                window.dispatchEvent(new CustomEvent('soso:stats-updated'));
                await tick();
                check(f.statsReads === current + 1, 'One stats update must produce one request');
                check(renderedPlays() === current + 1, 'Stats update did not render fresh result');
                tab('Внешний вид');
                await until(() => document.querySelector('.settings-appearance'));
                await tick();
                check(f.statsListeners.size === 0, 'Leaving stats leaked a listener');
                const idle = f.statsReads;
                window.dispatchEvent(new CustomEvent('soso:stats-updated'));
                await tick();
                check(f.statsReads === idle, 'Inactive tab requested statistics');
                tab('Статистика');
                await tick();
                check(f.statsReads === idle + 1, 'Returning to stats did not refresh once');
                window.setSettingsOpen(false);
                await until(() => !document.querySelector('[role="dialog"]'));
                await tick();
                check(f.statsListeners.size === 0, 'Closing settings leaked stats listener');
                check(
                  f.accountListeners.size === 0 &&
                    f.offlineListeners.size === 0 &&
                    f.intervals.size === 0,
                  'Closed settings retained active account/offline/polling work',
                );
                const closed = f.statsReads;
                window.dispatchEvent(new CustomEvent('soso:stats-updated'));
                await tick();
                check(f.statsReads === closed, 'Closed settings processed stats update');
                window.setSettingsOpen(true);
                await until(() => document.querySelector('[role="dialog"]'));
                await tick();
                check(
                  f.statsReads === closed + 1,
                  'Reopening the selected stats tab must refresh once',
                );
                check(f.statsListeners.size === 1, 'Reopening duplicated stats listener');
                window.unmountSettings();
                await tick();
                check(
                  Object.values(listeners()).every((value) => value === 0),
                  'Unmount leaked subscriptions/timers: ' + JSON.stringify(listeners()),
                );
                const final = f.statsReads;
                window.dispatchEvent(new CustomEvent('soso:stats-updated'));
                await tick();
                check(f.statsReads === final, 'Unmounted settings processed stats update');
                check(!document.querySelector('[role="dialog"]'), 'Unmount left settings DOM');
                return {
                  layout,
                  strict,
                  mountStats: expectedMount,
                  rerenders: 4,
                  tabChanges: true,
                  statsEvent: true,
                  reopen: true,
                  cleanup: listeners(),
                };
              }.toString() +
              ')(' +
              JSON.stringify(layout) +
              ',' +
              JSON.stringify(strict) +
              ')',
          ),
          new Promise((_, reject) => {
            rendererDeadline = setTimeout(
              () => reject(Error('Settings renderer call timed out')),
              5000,
            );
          }),
        ]).finally(() => clearTimeout(rendererDeadline));
        console.log('SETTINGS_LIFECYCLE_OK ' + JSON.stringify(result));
      }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      'SETTINGS_LIFECYCLE_ISOLATION_OK ' + JSON.stringify({ externalRequests: 0, errors: 0 }),
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
