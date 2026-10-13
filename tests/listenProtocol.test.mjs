import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import {
  buildSoSoListenUrl,
  parseSoSoListenTrack,
  getSoSoListenTrackFromArgs,
  buildLocalListenUrl,
  parseLocalListenTrack,
} from '../src/shared/utils/localListenLink.ts';
import { configureListenProtocol } from '../src/desktop/main/services/listenProtocol.ts';
import { LocalListenServer } from '../src/desktop/main/services/localListenServer.ts';

const song = {
  trackId: 'yt_W0LiTBNjJ_o',
  source: 'youtube',
  title: 'попал & "ещё"',
  artist: 'tewiq',
  duration: 106,
};
const request = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (part) => (body += part));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
const navigationHeaders = {
  'Sec-Fetch-User': '?1',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Dest': 'document',
};
const postHeaders = (origin) => ({ Origin: origin, 'X-SoSo-Listen': '1' });
function browser(
  page,
  origin,
  { visibility = 'visible', embedded = false, prerendering = false } = {},
) {
  const events = new Map();
  const button = {
    hidden: page.includes('<button id="play" hidden'),
    disabled: false,
    textContent: 'Слушать в SoSo Music',
  };
  const status = { textContent: '' };
  const document = {
    visibilityState: visibility,
    prerendering,
    getElementById: (id) => (id === 'play' ? button : status),
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name, callback) => {
      if (events.get(name) === callback) events.delete(name);
    },
  };
  const window = {};
  window.self = window;
  window.top = embedded ? {} : window;
  let requests = 0,
    reloads = 0;
  const context = vm.createContext({
    document,
    window,
    AbortController,
    setTimeout,
    clearTimeout,
    location: { reload: () => reloads++ },
    fetch: async (path) => {
      requests++;
      const response = await request(origin + path, {
        method: 'POST',
        headers: postHeaders(origin),
      });
      return { ok: response.status === 204, status: response.status };
    },
  });
  vm.runInContext(page.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1], context);
  return {
    button,
    status,
    context,
    document,
    requests: () => requests,
    reloads: () => reloads,
    event: (name) => events.get(name)?.(),
    click: () => button.onclick(),
  };
}
async function settled(ui) {
  for (let i = 0; i < 100; i++) {
    if (!vm.runInContext('busy', ui.context)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error('Page handoff did not settle');
}

test('sosomusic links preserve exact source identity and encoded names without stream secrets', () => {
  for (const source of ['youtube', 'soundcloud']) {
    const data = {
      ...song,
      source,
      trackId: source === 'youtube' ? song.trackId : 'sc_12345',
      preview: 'https://secret.invalid/key',
    };
    const link = buildSoSoListenUrl(data),
      track = parseSoSoListenTrack(link);
    assert.ok(link.startsWith('sosomusic://listen?'));
    assert.ok(link.length <= 512);
    assert.equal(track.id, data.trackId);
    assert.equal(track.source, source);
    assert.equal(track.title, data.title);
    assert.equal(track.artist.name, data.artist);
    assert.equal(track.duration, 106);
    assert.ok(!link.includes('secret'));
  }
  const long = buildSoSoListenUrl({ ...song, title: '🎶'.repeat(1000), artist: 'Я'.repeat(1000) });
  assert.ok(long.length <= 512);
  assert.equal(parseSoSoListenTrack(long).id, song.trackId);
});
test('custom listen links reject files, commands, wrong hosts, credentials, ports and fragments', () => {
  const valid = buildSoSoListenUrl(song);
  for (const bad of [
    valid.replace('sosomusic:', 'https:'),
    valid.replace('//listen', '//other'),
    valid.replace('//listen', '//user:pass@listen'),
    valid.replace('//listen', '//listen:80'),
    valid.replace('//listen?', '//listen/play?'),
    valid + '#ignored',
    'sosomusic://listen?id=../../file&source=youtube',
    'sosomusic://listen?id=sc_123&source=deezer',
    'sosomusic://listen?' + 'a'.repeat(4096),
    '--' + valid,
  ]) {
    assert.equal(parseSoSoListenTrack(bad), null, bad.slice(0, 100));
  }
  assert.equal(
    getSoSoListenTrackFromArgs(['player.exe', '--inspect', 'bad', valid, '--other']).id,
    song.trackId,
  );
  assert.equal(getSoSoListenTrackFromArgs(['player.exe', 'file:///x', '--' + valid]), null);
  assert.equal(buildSoSoListenUrl({ ...song, trackId: '../file' }), null);
});
test('protocol routes cold start, existing instance and early open-url through one receiver', () => {
  const app = new EventEmitter(),
    registered = [],
    received = [];
  app.isPackaged = true;
  app.setAsDefaultProtocolClient = (scheme) => {
    registered.push(scheme);
    return true;
  };
  const link = buildSoSoListenUrl(song);
  configureListenProtocol(app, (track) => received.push(track), ['player.exe', link]);
  assert.deepEqual(registered, ['sosomusic']);
  assert.equal(received.length, 1);
  app.emit('second-instance', {}, ['player.exe', '--other', link]);
  let prevented = false;
  app.emit('open-url', { preventDefault: () => (prevented = true) }, link);
  assert.equal(prevented, true);
  assert.equal(received.length, 3);
  assert.ok(received.every((track) => track.id === song.trackId));
  app.emit('second-instance', {}, ['player.exe', 'sosomusic://listen?id=invalid&source=youtube']);
  app.emit(
    'open-url',
    {
      preventDefault: () => {
        throw Error('Unrelated URL intercepted');
      },
    },
    'https://example.invalid',
  );
  assert.equal(received.length, 3);
});
test('development Electron does not hijack the packaged protocol association', () => {
  const app = new EventEmitter();
  app.isPackaged = false;
  app.setAsDefaultProtocolClient = () => {
    throw Error('Association overwritten');
  };
  configureListenProtocol(app, () => {}, ['electron.exe', '.']);
});

test('explicit browser navigation sends track automatically once without a second click', async () => {
  const received = [],
    server = new LocalListenServer(),
    origin = await server.start((track) => received.push(track), 0);
  try {
    const page = await request(buildLocalListenUrl(song, origin), { headers: navigationHeaders });
    assert.equal(page.status, 200);
    assert.equal(received.length, 0, 'GET alone must never start audio');
    assert.ok(page.body.includes('href="sosomusic://listen?'));
    const ui = browser(page.body, origin);
    await settled(ui);
    assert.equal(ui.requests(), 1);
    assert.equal(received.length, 1);
    assert.equal(received[0].id, song.trackId);
    assert.equal(ui.button.hidden, true);
    assert.match(ui.status.textContent, /Трек передан/);
    ui.event('visibilitychange');
    ui.event('prerenderingchange');
    assert.equal(ui.requests(), 1);
    const token = page.body.match(/\/play\/([a-f0-9]{48})/)[1];
    assert.equal(
      (await request(origin + '/play/' + token, { method: 'POST', headers: postHeaders(origin) }))
        .status,
      410,
    );
  } finally {
    server.stop();
  }
});
test('preview, prefetch, iframe and navigation without activation require a page click', async () => {
  const received = [],
    server = new LocalListenServer(),
    origin = await server.start((track) => received.push(track), 0);
  try {
    for (const headers of [
      {},
      { ...navigationHeaders, 'Sec-Purpose': 'prefetch' },
      { ...navigationHeaders, Purpose: 'prefetch' },
      { ...navigationHeaders, 'Sec-Purpose': 'prefetch;prerender' },
      { ...navigationHeaders, 'Sec-Fetch-Dest': 'iframe' },
      { ...navigationHeaders, 'Sec-Fetch-User': undefined },
    ]) {
      const clean = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined));
      const page = await request(buildLocalListenUrl(song, origin), { headers: clean });
      const ui = browser(page.body, origin);
      await settled(ui);
      assert.equal(ui.requests(), 0);
      assert.equal(ui.button.hidden, false);
      assert.equal(received.length, 0);
    }
    const page = await request(buildLocalListenUrl(song, origin));
    const ui = browser(page.body, origin);
    await ui.click();
    assert.equal(received.length, 1);
    assert.equal(ui.button.hidden, true);
  } finally {
    server.stop();
  }
});
test('automatic handoff waits for a visible top-level page and does not execute while prerendering', async () => {
  const received = [],
    server = new LocalListenServer(),
    origin = await server.start((track) => received.push(track), 0);
  try {
    const page = await request(buildLocalListenUrl(song, origin), { headers: navigationHeaders });
    const hidden = browser(page.body, origin, { visibility: 'hidden' });
    assert.equal(hidden.requests(), 0);
    hidden.document.visibilityState = 'visible';
    hidden.event('visibilitychange');
    await settled(hidden);
    assert.equal(hidden.requests(), 1);
    assert.equal(received.length, 1);
    const second = await request(buildLocalListenUrl(song, origin), { headers: navigationHeaders });
    const preload = browser(second.body, origin, { prerendering: true });
    assert.equal(preload.requests(), 0);
    preload.document.prerendering = false;
    preload.event('prerenderingchange');
    await settled(preload);
    assert.equal(received.length, 2);
    const third = await request(buildLocalListenUrl(song, origin), { headers: navigationHeaders });
    const frame = browser(third.body, origin, { embedded: true });
    assert.equal(frame.requests(), 0);
  } finally {
    server.stop();
  }
});
test('failed handoff exposes an enabled retry button and succeeds without consuming the token early', async () => {
  let attempts = 0;
  const received = [],
    server = new LocalListenServer();
  const origin = await server.start((track) => {
    attempts++;
    if (attempts === 1) throw Error('Receiver not ready');
    received.push(track);
  }, 0);
  try {
    const page = await request(buildLocalListenUrl(song, origin), { headers: navigationHeaders });
    const ui = browser(page.body, origin);
    await settled(ui);
    assert.equal(ui.button.hidden, false);
    assert.equal(ui.button.disabled, false);
    assert.equal(ui.button.textContent, 'Повторить');
    assert.equal(received.length, 0);
    await ui.click();
    assert.equal(received.length, 1);
    assert.equal(ui.button.hidden, true);
  } finally {
    server.stop();
  }
});
test('expired handoff refreshes only on an explicit retry rather than auto-looping', async () => {
  const server = new LocalListenServer(),
    origin = await server.start(() => {}, 0);
  try {
    const page = await request(buildLocalListenUrl(song, origin), { headers: navigationHeaders });
    const token = page.body.match(/\/play\/([a-f0-9]{48})/)[1];
    await request(origin + '/play/' + token, { method: 'POST', headers: postHeaders(origin) });
    const ui = browser(page.body, origin);
    await settled(ui);
    assert.equal(ui.button.hidden, false);
    assert.equal(ui.reloads(), 0);
    await ui.click();
    assert.equal(ui.reloads(), 1);
    assert.equal(ui.requests(), 1);
  } finally {
    server.stop();
  }
});

test('Discord links preserve long original album artwork and Cyrillic names within the URL budget', () => {
  const cover =
    'https://lh3.googleusercontent.com/' + 'albumArtwork'.repeat(16) + '=w544-h544-l90-rj';
  const data = { ...song, title: 'дырки в штанах', artist: 'madk1d', coverUrl: cover };
  for (const build of [buildLocalListenUrl, buildSoSoListenUrl]) {
    const url = build(data);
    assert.ok(url.length <= 512);
    const track = url.startsWith('sosomusic:')
      ? parseSoSoListenTrack(url)
      : parseLocalListenTrack(new URL(url));
    assert.equal(track.cover_url, cover);
    assert.equal(track.album.cover_xl, cover);
    assert.equal(track.title, data.title);
    assert.equal(track.artist.name, data.artist);
  }
});
