import test from 'node:test';
import assert from 'node:assert/strict';
import { english } from '../src/shared/i18n/en.ts';
const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
const storageListeners = new Set();
globalThis.window = {
  addEventListener: (type, fn) => {
    if (type === 'storage') storageListeners.add(fn);
  },
  removeEventListener: (type, fn) => storageListeners.delete(fn),
};
globalThis.document = { documentElement: { lang: '' } };
const { t, getLocale, getIntlLocale, setLocale, subscribeLocale } =
  await import('../src/shared/i18n/locale.ts');
test('Language changes persist, notify mounted consumers, and update document language without remounting', () => {
  assert.equal(getLocale(), 'ru');
  let renders = 0;
  const unsubscribe = subscribeLocale(() => renders++);
  setLocale('en');
  assert.equal(values.get('soso_language'), 'en');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(renders, 1);
  assert.equal(t('Моя волна'), 'My Wave');
  assert.equal(getIntlLocale(), 'en-US');
  setLocale('en');
  assert.equal(renders, 1);
  setLocale('ru');
  assert.equal(t('Моя волна'), 'Моя волна');
  unsubscribe();
  assert.equal(storageListeners.size, 0);
});
test('An isolated overlay does not publish its local default language back to the main application', () => {
  const sent = [];
  window.location = { hash: '#/overlay' };
  window.electronAPI = { setInterfaceLanguage: async (language) => sent.push(language) };
  setLocale('en');
  setLocale('ru');
  assert.deepEqual(sent, []);
  window.location.hash = '';
  setLocale('en');
  assert.deepEqual(sent, ['en']);
  setLocale('ru');
  delete window.location;
  delete window.electronAPI;
});

test('Interpolation leaves music metadata untouched and preserves sentence spacing', () => {
  setLocale('en');
  assert.equal(t('Ошибка: {0}', 'Русское название'), 'Error: Русское название');
  assert.equal(t(' треков'), ' tracks');
  assert.equal(t('Unknown song title'), 'Unknown song title');
  assert.equal(t('constructor'), 'constructor');
  assert.equal(t('toString'), 'toString');
  assert.equal(t('{0} ч {1} мин', 2, 3), '2 h 3 min');
  assert.ok(Object.keys(english).length > 700);
  setLocale('ru');
});
test('A language change in another window is applied and listener cleanup is complete', () => {
  const off = subscribeLocale(() => {});
  values.set('soso_language', 'en');
  for (const fn of storageListeners) fn({ key: 'soso_language' });
  assert.equal(getLocale(), 'en');
  values.delete('soso_language');
  for (const fn of storageListeners) fn({ key: null });
  assert.equal(getLocale(), 'ru');
  off();
  assert.equal(storageListeners.size, 0);
});

test('Native language IPC validates its input and rebuilds translated tray commands', async () => {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const { stripTypeScriptTypes } = await import('node:module');
  const { extractStatement, extractEventRegistration } =
    await import('./helpers/sourceInspection.mjs');
  const source = readFileSync(new URL('../src/desktop/main/index.ts', import.meta.url), 'utf8');
  let changeLanguage,
    rebuilds = 0;
  const overlayLanguages = [];
  vm.runInNewContext(
    stripTypeScriptTypes(extractEventRegistration(source, 'app:setInterfaceLanguage')),
    {
      ipcMain: {
        handle: (_event, handler) => {
          changeLanguage = handler;
        },
      },
      setUiLocale: setLocale,
      playerOverlay: { setLanguage: (language) => overlayLanguages.push(language) },
      updateTrayLanguage: () => rebuilds++,
      TypeError,
    },
  );
  assert.throws(() => changeLanguage(null, 'fr'), /Unsupported interface language/);
  assert.equal(rebuilds, 0);
  changeLanguage(null, 'en');
  assert.equal(rebuilds, 1);
  assert.deepEqual(overlayLanguages, ['en']);
  let tooltip, menu;
  vm.runInNewContext(
    stripTypeScriptTypes(
      extractStatement(source, (text) => text.startsWith('function updateTrayLanguage(')),
    ) + '\nupdateTrayLanguage();',
    {
      t,
      tray: {
        setToolTip: (value) => {
          tooltip = value;
        },
        setContextMenu: (value) => {
          menu = value;
        },
      },
      Menu: { buildFromTemplate: (value) => value },
      mainWindow: null,
      app: { quit() {} },
      isQuitting: false,
    },
  );
  assert.equal(tooltip, 'SoSo Music — Music player');
  assert.equal(menu[0].label, 'Open SoSo Music');
  assert.equal(menu[2].label, 'Quit');
  setLocale('ru');
});
