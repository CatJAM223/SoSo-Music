import { t } from '../src/shared/i18n/locale.ts';
import { extractEventRegistration } from './helpers/sourceInspection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { hookRuntime } from './helpers/hookRuntime.mjs';

function fixture() {
  const window = new EventTarget(),
    toasts = [],
    notices = [];
  let listener, completeInitial;
  window.electronAPI = {
    onLibraryPersistenceStatus: (callback) => {
      listener = callback;
      return () => (listener = null);
    },
    getLibraryPersistenceStatus: () => new Promise((resolve) => (completeInitial = resolve)),
  };
  const h = hookRuntime(
    new URL('../src/shared/hooks/useLibraryPersistenceNotifications.ts', import.meta.url),
    {},
    { window },
  );
  h.render({
    setToasts: (update) => {
      toasts.splice(0, toasts.length, ...update(toasts));
    },
    showToast: (...args) => notices.push(args),
  });
  return {
    window,
    h,
    toasts,
    notices,
    emit: (status) => listener(status),
    initial: (status) => completeInitial(status),
    hasListener: () => !!listener,
  };
}

test('Library save error stays visible; stale initial success cannot dismiss a newer error', async () => {
  const f = fixture();
  f.emit({ state: 'error', message: 'Disk full' });
  f.initial({ state: 'ready' });
  await f.h.flush();
  assert.equal(f.toasts.length, 1);
  assert.equal(f.toasts[0].message, 'Disk full');
  assert.equal(f.toasts[0].duration, 0);
  f.emit({ state: 'error', message: 'Disk disconnected' });
  assert.equal(f.toasts.length, 1);
  assert.equal(f.toasts[0].message, 'Disk disconnected');
  f.emit({ state: 'ready' });
  assert.equal(f.toasts.length, 0);
  f.h.unmount();
  assert.equal(f.hasListener(), false);
});

test('Startup recovery is reported once and Android write failures are shown too', async () => {
  const f = fixture();
  f.initial({ state: 'recovered' });
  await f.h.flush();
  assert.equal(f.notices.length, 1);
  f.emit({ state: 'recovered' });
  assert.equal(f.notices.length, 1);
  f.window.dispatchEvent(
    new CustomEvent('soso:storage-error', { detail: { message: 'Storage unavailable' } }),
  );
  assert.equal(f.toasts[0].message, 'Storage unavailable');
  f.h.unmount();
  f.window.dispatchEvent(new CustomEvent('soso:storage-error', { detail: { message: 'late' } }));
  assert.equal(f.toasts[0].message, 'Storage unavailable');
});

test('Late initial persistence status has no observer side effects after unmount', async () => {
  const f = fixture();
  f.h.unmount();
  f.initial({ state: 'error', message: 'late' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.toasts.length, 0);
});

const main = fs.readFileSync(new URL('../src/desktop/main/index.ts', import.meta.url), 'utf8');
function quitFixture({ fail = false, choice = 0 } = {}) {
  const events = [];
  let quit;
  const registration = extractEventRegistration(main, 'before-quit');
  const context = {
    t,
    libraryTaste: { dispose() {} },
    databaseReady: true,
    isQuitting: true,
    app: {
      on: (name, fn) => {
        assert.equal(name, 'before-quit');
        quit = fn;
      },
    },
    dbManager: {
      saveSync() {
        events.push('save');
        if (fail) throw Error('Disk failure');
      },
    },
    PlaybackLogger: { error() {} },
    dialog: {
      showMessageBoxSync(options) {
        events.push('dialog');
        assert.equal(options.defaultId, 0);
        assert.equal(options.cancelId, 0);
        return choice;
      },
    },
    disposeAccountHandlers: () => events.push('account-handlers-disposed'),
    youtubeAccount: { dispose: () => events.push('account-disposed') },
    lanSyncServer: { stop: () => events.push('lan-stopped') },
    localListenServer: { stop: () => events.push('listen-stopped') },
    DiscordRPCService: { clearActivity: () => events.push('rpc-cleared') },
    mainWindow: { show: () => events.push('shown') },
  };
  vm.runInNewContext(stripTypeScriptTypes(registration), context);
  return { events, context, run: () => quit({ preventDefault: () => events.push('prevented') }) };
}

test('Failed quit save keeps services alive until the user explicitly chooses unsafe exit', () => {
  const f = quitFixture({ fail: true });
  f.run();
  assert.deepEqual(f.events, ['save', 'dialog', 'prevented', 'shown']);
  assert.equal(f.context.isQuitting, false);
  const confirmed = quitFixture({ fail: true, choice: 1 });
  confirmed.run();
  assert.ok(confirmed.events.includes('account-disposed'));
  assert.ok(!confirmed.events.includes('prevented'));
});

test('Normal quit saves before releasing services, and failed startup cannot silently start empty', async () => {
  const f = quitFixture();
  f.run();
  assert.equal(f.events[0], 'save');
  assert.ok(f.events.includes('rpc-cleared'));
  const begin = main.indexOf('async function createWindow() {');
  const end = main.indexOf('  const iconPath =', begin);
  assert.ok(begin > 0 && end > begin);
  const events = [],
    context = {
      t,
      databaseReady: false,
      dbManager: {
        init: async () => {
          throw Error('Original library unreadable');
        },
      },
      dialog: { showErrorBox: (_, message) => events.push(message) },
      app: { exit: (code) => events.push(code) },
      Error,
    };
  vm.runInNewContext(
    stripTypeScriptTypes(main.slice(begin, end) + '}\nthis.start=createWindow;'),
    context,
  );
  await context.start();
  assert.equal(context.databaseReady, false);
  assert.deepEqual(events, ['Original library unreadable', 1]);
});
