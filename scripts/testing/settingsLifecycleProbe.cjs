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
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true,
    });
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
                const dialog = () => document.querySelector('dialog.settings-modal:modal');
                const opener = document.getElementById('settings-opener');
                opener.focus();
                window.mountSettings(layout, strict);
                await until(dialog);
                await tick();
                check(dialog().contains(document.activeElement), 'Settings did not take focus');
                opener.focus();
                check(dialog().contains(document.activeElement), 'Background is still focusable');
                const tabs = [...dialog().querySelectorAll('[role="tab"]')];
                const tabStops = () => tabs.filter((button) => button.tabIndex === 0);
                check(tabStops().length === 1 && tabStops()[0] === tabs[0], 'Invalid tab stops');
                tabs[0].focus();
                tabs[0].dispatchEvent(
                  new KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                    cancelable: true,
                  }),
                );
                await until(() => tabStops()[0] === tabs[1]);
                check(document.activeElement === tabs[1], 'Arrow key did not move focus');
                check(tabs[0].getAttribute('aria-selected') === 'true', 'Arrow activated a tab');
                tabs[1].dispatchEvent(
                  new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
                );
                check(document.activeElement === tabs.at(-1), 'End did not focus the last tab');
                dialog().querySelector('.settings-close').focus();
                await until(() => tabStops()[0] === tabs[0]);
                check(
                  tabs.every((button) =>
                    document.getElementById(button.getAttribute('aria-controls')),
                  ),
                  'Tab controls do not reference their panels',
                );
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
                const appearanceMode = dialog().querySelector('[aria-label="Режим оформления"]');
                const scheme = () => document.querySelector('meta[name="color-scheme"]').content;
                const mode = (label) =>
                  [...appearanceMode.querySelectorAll('button')].find(
                    (button) => button.textContent.trim() === label,
                  );
                mode('Светлый').click();
                await until(() => scheme() === 'light');
                check(
                  getComputedStyle(document.documentElement).colorScheme === 'light',
                  'Light native colors not applied',
                );
                mode('Тёмный').click();
                await until(() => scheme() === 'dark');
                check(
                  getComputedStyle(document.documentElement).colorScheme === 'dark',
                  'Dark native colors not applied',
                );
                check(f.statsListeners.size === 0, 'Leaving stats leaked a listener');
                const idle = f.statsReads;
                window.dispatchEvent(new CustomEvent('soso:stats-updated'));
                await tick();
                check(f.statsReads === idle, 'Inactive tab requested statistics');
                tab('Статистика');
                await tick();
                check(f.statsReads === idle + 1, 'Returning to stats did not refresh once');
                window.setSettingsOpen(false);
                await until(() => !dialog());
                check(document.activeElement === opener, 'Closing settings lost opener focus');
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
                await until(dialog);
                await tick();
                check(
                  f.statsReads === closed + 1,
                  'Reopening the selected stats tab must refresh once',
                );
                check(f.statsListeners.size === 1, 'Reopening duplicated stats listener');
                window.settingsBridge.startLanSync = async () => ({
                  active: true,
                  code: '12345678',
                  addresses: ['http://192.168.1.2:8080'],
                });
                tab('Данные');
                const action = (label) =>
                  [...dialog().querySelectorAll('button')].find(
                    (button) => button.textContent.trim() === label,
                  );
                await until(() => {
                  const button = action('Очистить кэш');
                  return button && !button.disabled;
                });
                const clear = action('Очистить кэш');
                clear.focus();
                clear.click();
                const confirm = () => document.querySelector('dialog.confirm-delete-dialog:modal');
                await until(confirm);
                check(
                  document.activeElement.textContent.trim() === 'Отмена',
                  'Unsafe initial focus in confirmation',
                );
                confirm().requestClose();
                await until(() => !confirm());
                check(document.activeElement === clear, 'Confirmation did not restore focus');
                clear.click();
                await until(confirm);
                const confirmClear = [...confirm().querySelectorAll('button')].find(
                  (button) => button.textContent.trim() === 'Очистить кэш',
                );
                confirmClear.click();
                await until(() => !confirm() && clear.disabled);
                check(
                  document.activeElement.textContent.trim() === 'Хранилище',
                  'Cache clear lost focus when its trigger became unavailable',
                );
                await until(() => action('Открыть сеанс'));
                action('Открыть сеанс').click();
                await until(() => dialog().querySelector('.settings-qr'));
                const qrOpener = dialog().querySelector('.settings-qr');
                qrOpener.focus();
                qrOpener.click();
                const qr = () => document.querySelector('dialog.settings-qr-dialog:modal');
                await until(qr);
                check(qr().contains(document.activeElement), 'Expanded QR did not take focus');
                const qrFocus = document.activeElement;
                window.pushSettingsImport({
                  id: 'phone-import',
                  address: '192.168.1.2',
                  tracks: 3,
                  playlists: 1,
                  albums: 0,
                  artists: 0,
                });
                const consent = () => document.querySelector('dialog.soso-connection-dialog:modal');
                await until(consent);
                check(consent().contains(document.activeElement), 'Phone consent is behind QR');
                consent().requestClose();
                await until(() => !consent());
                check(
                  document.activeElement === qrFocus && f.importResponses[0]?.accepted === false,
                  'Phone consent did not reject the request and restore QR focus',
                );
                qr().requestClose();
                await until(() => !qr());
                check(document.activeElement === qrOpener, 'QR dialog did not restore focus');
                dialog().requestClose();
                await until(() => !dialog());
                check(document.activeElement === opener, 'Native cancel did not restore focus');
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
                check(!dialog(), 'Unmount left settings DOM');
                return {
                  layout,
                  strict,
                  mountStats: expectedMount,
                  rerenders: 4,
                  tabChanges: true,
                  statsEvent: true,
                  reopen: true,
                  dialogFocus: true,
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
    win.webContents.debugger.detach();
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
