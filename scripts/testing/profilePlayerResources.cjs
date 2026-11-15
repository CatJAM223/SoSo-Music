// Run with Electron against a production build in an isolated profile.
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const launched = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (launched.error) throw launched.error;
  process.exit(launched.status ?? 1);
}
const { app, BrowserWindow, dialog, ipcMain, protocol, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: wait } = require('node:timers/promises');

const [build, output, size = '10000', duration = '15', ...flags] = process.argv.slice(2);
assert.ok(build && output, 'Expected build path and output file');
const root = path.resolve(build);
app.getAppPath = () => path.resolve(__dirname, '../..');
const seconds = Number(duration);
const count = Number(size);
assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 50000);
assert.ok(Number.isSafeInteger(seconds) && seconds >= 5 && seconds <= 3600);
const scratch = path.resolve('scratch');
fs.mkdirSync(scratch, { recursive: true });
const profile = fs.mkdtempSync(path.join(scratch, 'resource-profile-'));
const fixturePath = path.join(profile, 'fixture.json');
for (const name of ['userData', 'sessionData', 'crashDumps']) app.setPath(name, profile);
fs.writeFileSync(path.join(profile, 'desktop-controls.json'), '{"overlayEnabled":false}');

const tracks = Array.from({ length: count }, (_, index) => ({
  deezer_id: 'sc_' + (index + 1),
  title: 'Fixture track ' + (index + 1),
  artist: 'Fixture artist ' + (index % 317),
  liked_at: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
  duration: 30,
}));
fs.writeFileSync(fixturePath, JSON.stringify({ liked_tracks: tracks }));
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixturePath] });

const toneUrl = 'media://offline/01234567-abcd-efab-cdef-0123456789ab.mp3';
const rate = 16000;
const tone = Buffer.alloc(44 + rate * 30 * 2);
tone.write('RIFF');
tone.writeUInt32LE(tone.length - 8, 4);
tone.write('WAVEfmt ', 8);
tone.writeUInt32LE(16, 16);
tone.writeUInt16LE(1, 20);
tone.writeUInt16LE(1, 22);
tone.writeUInt32LE(rate, 24);
tone.writeUInt32LE(rate * 2, 28);
tone.writeUInt16LE(2, 32);
tone.writeUInt16LE(16, 34);
tone.write('data', 36);
tone.writeUInt32LE(tone.length - 44, 40);
for (let i = 44; i < tone.length; i += 2)
  tone.writeInt16LE(Math.round(1000 * Math.sin((((i - 44) / 2) * Math.PI * 880) / rate)), i);

const handle = protocol.handle.bind(protocol);
protocol.handle = (scheme, handler) =>
  handle(scheme, (request) => {
    if (request.url !== toneUrl) return handler(request);
    const range = request.headers.get('range')?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), tone.length - 1) : tone.length - 1;
    const headers = {
      'content-type': 'audio/wav',
      'content-length': String(end - start + 1),
      'accept-ranges': 'bytes',
    };
    if (start > end) return new Response(null, { status: 416 });
    if (range) headers['content-range'] = `bytes ${start}-${end}/${tone.length}`;
    return new Response(tone.subarray(start, end + 1), { status: range ? 206 : 200, headers });
  });
const calls = {};
const databaseWrites = { files: 0, bytes: 0 };
const databaseFile = (file) =>
  typeof file === 'string' && file.startsWith(path.join(profile, 'soso_music.sqlite.tmp.'));
const fdWrites = new Set();
const openSync = fs.openSync;
fs.openSync = (file, ...args) => {
  const fd = openSync(file, ...args);
  if (databaseFile(file)) fdWrites.add(fd);
  return fd;
};
const closeSync = fs.closeSync;
fs.closeSync = (fd) => {
  fdWrites.delete(fd);
  return closeSync(fd);
};
const writeSync = fs.writeFileSync;
fs.writeFileSync = (file, data, ...args) => {
  if (fdWrites.has(file)) {
    databaseWrites.files++;
    databaseWrites.bytes += Buffer.byteLength(data);
  }
  return writeSync(file, data, ...args);
};
const writeAsync = fs.promises.writeFile;
fs.promises.writeFile = (file, data, ...args) => {
  if (databaseFile(file)) {
    databaseWrites.files++;
    databaseWrites.bytes += Buffer.byteLength(data);
  }
  return writeAsync(file, data, ...args);
};
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) =>
  register(channel, (...args) => {
    calls[channel] = (calls[channel] || 0) + 1;
    if (channel === 'music:getFullStreamUrl') return toneUrl;
    return handler(...args);
  });
ipcMain.on('widget:sendState', () => {
  calls.widgetState = (calls.widgetState || 0) + 1;
});
ipcMain.on('widget:sendProgress', () => {
  calls.widgetProgress = (calls.widgetProgress || 0) + 1;
});

const result = { count, seconds, throttling: flags.includes('--throttle'), phases: {} };
let blocked = 0;
let main;
const run = (code) => main.webContents.executeJavaScript(code, true);
async function until(check, label) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await wait(50);
  }
  throw Error('Timed out: ' + label);
}
const ready = () =>
  run("Boolean(document.querySelector('#root')?.children.length && window.electronAPI)");
const playing = () =>
  run('Boolean(window.fixtureAudio && !fixtureAudio.paused && fixtureAudio.currentTime > 0)');

async function sample(name) {
  await wait(1200);
  app.getAppMetrics();
  const before = { ...calls };
  const writesBefore = { ...databaseWrites };
  const from = Date.now();
  const samples = [];
  for (let i = 0; i < seconds; i++) {
    await wait(Math.max(0, from + (i + 1) * 1000 - Date.now()));
    samples.push({
      elapsedMs: Date.now() - from,
      processes: app.getAppMetrics().map(({ pid, type, cpu, memory, serviceName }) => ({
        pid,
        type,
        serviceName,
        cpu: cpu.percentCPUUsage,
        cpuSeconds: cpu.cumulativeCPUUsage,
        privateKB: memory.privateBytes,
        workingSetKB: memory.workingSetSize,
      })),
    });
  }
  result.phases[name] = {
    samples,
    databaseWrites: {
      files: databaseWrites.files - writesBefore.files,
      bytes: databaseWrites.bytes - writesBefore.bytes,
    },
    ipc: Object.fromEntries(
      Object.entries(calls)
        .filter(([k, v]) => v !== before[k])
        .map(([k, v]) => [k, v - (before[k] || 0)]),
    ),
  };
}

app.on('browser-window-created', (_event, window) => {
  if (main) return;
  main = window;
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_request, callback) => {
      blocked++;
      callback({ cancel: true });
    },
  );
  if (flags.includes('--throttle')) main.webContents.setBackgroundThrottling(true);
  void (async () => {
    await wait(300);
    await until(ready, 'player mounted');
    result.startupMs = Math.round(performance.now());
    await run(`localStorage.setItem('soso_onboarding_completed','true');
      localStorage.setItem('soso_discord_rpc','false');
      localStorage.setItem('soso_playback_session_v1',${JSON.stringify(
        JSON.stringify({
          version: 1,
          track: {
            id: 'sc_1',
            source: 'soundcloud',
            title: tracks[0].title,
            artist: { name: tracks[0].artist },
            duration: 30,
          },
          queue: [
            {
              id: 'sc_1',
              source: 'soundcloud',
              title: tracks[0].title,
              artist: { name: tracks[0].artist },
              duration: 30,
            },
          ],
          position: 0,
          queueIndex: 0,
          repeatMode: 'one',
          isShuffle: false,
        }),
      )});`);
    assert.ok((await run('window.electronAPI.importDatabase()')).success);
    const themes = flags.includes('--queue-only') ? [] : ['default', 'blackhole'];
    for (const theme of themes) {
      await run(`localStorage.setItem('soso_theme_preset', '${theme}')`);
      await main.loadFile(path.join(root, 'dist', 'index.html'));
      main.show();
      main.focus();
      await until(ready, 'player restored');
      if (theme === 'default') await sample('pausedVisible');
      await run(`(() => {
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          if (this instanceof HTMLAudioElement) window.fixtureAudio = this;
          return play.call(this);
        };
      })()`);
      await until(
        () =>
          run(`(() => {
        const button = document.querySelector('[data-tour="player-bar"] button:has(svg.lucide-play)');
        if (!button) return false;
        button.click(); return true;
      })()`),
        'play control',
      );
      await until(playing, 'fixture audio');
      await sample(theme + 'PlayingVisible');
      if (theme === 'blackhole') {
        result.blackholePixels = await run(
          "document.querySelector('canvas')?.width * document.querySelector('canvas')?.height || 0",
        );
        main.hide();
        const timeInTray = await run('fixtureAudio.currentTime');
        await sample('playingHidden');
        assert.equal(await playing(), true, 'audio in tray');
        assert.notEqual(
          await run('fixtureAudio.currentTime'),
          timeInTray,
          'audio clock advances in tray',
        );
        main.show();
        await run(
          `document.querySelector('[data-tour="player-bar"] button:has(svg.lucide-pause)')?.click()`,
        );
        await until(async () => !(await playing()), 'pause');
        main.hide();
        await sample('pausedHidden');
      }
    }
    main.show();
    result.libraryQueue = await run(`(async () => {
      const roundTripsMs = [];
      let rows;
      for (let i = 0; i < 5; i++) {
        const now = performance.now();
        rows = await (window.electronAPI.getLibraryPlaybackRows ?? window.electronAPI.getLibraryPlaybackTracks)({});
        roundTripsMs.push(performance.now() - now);
      }
      return { rows: rows.length, roundTripsMs, jsonBytes: new TextEncoder().encode(JSON.stringify(rows)).length };
    })()`);
    assert.equal(result.libraryQueue.rows, count);
    result.blockedExternalRequests = blocked;
    const beforeQuit = { ...databaseWrites };
    app.once('will-quit', () => {
      result.cleanQuitDatabaseWrites = {
        files: databaseWrites.files - beforeQuit.files,
        bytes: databaseWrites.bytes - beforeQuit.bytes,
      };
      fs.writeFileSync(path.resolve(output), JSON.stringify(result, null, 2));
      console.log('PLAYER_RESOURCES_OK ' + output);
    });
    app.quit();
  })().catch((error) => {
    console.error(error);
    app.exit(1);
  });
});
setTimeout(
  () => {
    console.error('Resource profile timed out');
    app.exit(1);
  },
  seconds * 5000 + 60000,
).unref();
require(path.join(root, 'dist-electron', 'main.js'));
