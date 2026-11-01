const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const output = path.resolve(process.argv[2]),
  root = path.resolve(process.argv[3]);
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let stage = 'startup',
  relay,
  audioServer;
const windows = [],
  bridges = [];
const internetMode = process.env.SOSO_TEST_ROOMS_INTERNET === '1';
const report = {
  transport: internetMode ? 'iroh-public-relay' : 'local-websocket',
  checks: [],
  audioRequests: 0,
};
const deadline = setTimeout(() => {
  console.error('Room playback timeout: ' + stage);
  cleanup(1);
}, 160000);
function cleanup(code) {
  clearTimeout(deadline);
  for (const bridge of bridges) bridge.dispose();
  for (const win of windows) if (!win.isDestroyed()) win.destroy();
  relay?.kill();
  audioServer?.close();
  app.exit(code);
}
function tone() {
  const rate = 12000,
    frames = rate * 90,
    buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    buffer.writeInt16LE(Math.round(Math.sin((i / rate) * Math.PI * 440) * 1000), 44 + i * 2);
  return buffer;
}
app.whenReady().then(async () => {
  try {
    const wav = tone();
    audioServer = http.createServer((request, response) => {
      report.audioRequests++;
      const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = match ? Number(match[1]) : 0,
        end = match && match[2] ? Math.min(Number(match[2]), wav.length - 1) : wav.length - 1;
      const headers = {
        'Content-Type': 'audio/wav',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      };
      if (match) headers['Content-Range'] = `bytes ${start}-${end}/${wav.length}`;
      response.writeHead(match ? 206 : 200, headers);
      response.end(wav.subarray(start, end + 1));
    });
    await new Promise((resolve) => audioServer.listen(0, '127.0.0.1', resolve));
    const audio = `http://127.0.0.1:${audioServer.address().port}`;
    relay = spawn(
      path.join(root, 'build/native/soso-rooms' + (process.platform === 'win32' ? '.exe' : '')),
      ['--relay', '127.0.0.1:0'],
      { windowsHide: true },
    );
    const port = await new Promise((resolve, reject) => {
      let diagnostics = '';
      const timer = setTimeout(() => reject(Error('Relay startup timeout: ' + diagnostics)), 15000);
      relay.on('error', reject);
      relay.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error('Relay exited: ' + code + ' ' + diagnostics));
      });
      relay.stderr.on('data', (data) => {
        diagnostics += String(data);
        const match = diagnostics.match(/\(port (\d+)\)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
    });
    const endpoint = `ws://127.0.0.1:${port}/`;
    const { ListeningRooms } = require(path.join(output, 'bridge.cjs'));
    const handlers = new Map();
    ipcMain.handle('rooms:request', (event, request) =>
      // Decoder regression uses a local relay; public transport has a dedicated test.
      handlers.get(event.sender.id)(
        event,
        request.op === 'create' && !internetMode
          ? { ...request, payload: { ...request.payload, mode: 'relay', relay: endpoint } }
          : request,
      ),
    );
    // Other native library/desktop calls remain isolated from the real user's data.
    const preloadSource = fs.readFileSync(path.join(root, 'src/desktop/preload/index.ts'), 'utf8');
    const channels = new Set(
      [...preloadSource.matchAll(/ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g)].map(
        (match) => match[1],
      ),
    );
    for (const channel of channels)
      if (channel !== 'rooms:request')
        ipcMain.handle(channel, async () => {
          if (channel === 'music:downloadAudioBuffer') return new Uint8Array(wav);
          if (channel === 'app:getAvailableUpdate') return null;
          return [];
        });
    for (const role of ['host', 'guest']) {
      const win = new BrowserWindow({
        show: false,
        width: 1100,
        height: 820,
        webPreferences: {
          preload: path.join(output, 'preload.cjs'),
          partition: 'room-playback-' + role,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      windows.push(win);
      win.webContents.setAudioMuted(true);
      win.webContents.session.webRequest.onBeforeRequest((details, reply) =>
        reply({
          cancel: !(
            details.url.startsWith(audio + '/') || /^(file|data|blob|devtools):/.test(details.url)
          ),
        }),
      );
      const bridge = new ListeningRooms();
      bridges.push(bridge);
      bridge.register(
        { handle: (channel, handler) => handlers.set(win.webContents.id, handler) },
        () => win,
      );
      await win.loadFile(path.join(output, 'index.html'), {
        query: { role, relay: endpoint, audio },
      });
    }
    const [host, guest] = windows;
    const js = (win, code) => win.webContents.executeJavaScript(code);
    const wait = async (win, expression, label, budget = 12000) => {
      stage = label;
      const until = Date.now() + budget;
      while (Date.now() < until) {
        const value = await js(win, `({ok:Boolean(${expression}),error:window.fixtureError})`);
        if (value.error) throw Error(value.error);
        if (value.ok) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw Error(
        label +
          ': ' +
          JSON.stringify(
            await js(
              win,
              '({track:window.roomProbe?.audio.currentTrack?.id,queue:window.roomProbe?.audio.queue.map(t=>t.id),phase:window.roomProbe?.audio.playbackPhase,playing:window.roomProbe?.audio.isPlaying,time:window.roomProbe?.controls.getPlaybackTime(),room:window.roomProbe?.room.status,error:window.roomProbe?.room.error})',
            ),
          ),
      );
    };
    const check = (name) => {
      report.checks.push(name);
      console.log('ROOM_PLAYBACK_OK ' + name);
    };
    for (const win of windows)
      await wait(
        win,
        'window.roomProbe&&document.querySelectorAll(".room-choice").length===2',
        'renderer startup',
      );
    await js(host, 'document.querySelectorAll(".room-choice")[0].click()');
    await wait(host, 'document.querySelector("input[name=roomName]")', 'create form');
    await js(host, 'document.querySelector("form").requestSubmit()');
    await wait(host, 'window.roomProbe.room.status==="connected"', 'host create');
    const invitation = await js(host, 'window.roomProbe.room.invitation');
    await js(guest, 'document.querySelectorAll(".room-choice")[1].click()');
    await wait(guest, 'document.querySelector("textarea[name=invitation]")', 'join form');
    await js(
      guest,
      'document.querySelector("textarea[name=invitation]").value="broken invitation";document.querySelector("form").requestSubmit()',
    );
    await wait(
      guest,
      'document.querySelector(".room-error")?.textContent.includes("Приглашение не распознано")',
      'invalid invitation shown',
    );
    await js(
      guest,
      'document.querySelector("textarea[name=invitation]").value=' +
        JSON.stringify(invitation) +
        ';document.querySelector("form").requestSubmit()',
    );
    await wait(
      guest,
      'window.roomProbe.room.status==="connected"&&window.roomProbe.room.members.length===2',
      'guest join',
    );
    check('two isolated renderers joined through real preload, IPC and Rust relay');
    assert.equal(await js(guest, 'Boolean(document.querySelector(".room-error"))'), false);
    check('invalid invitation can be corrected without restarting');
    const track = (id) => ({
      id,
      source: 'soundcloud',
      title: 'Fixture ' + id,
      artist: { name: 'Room test' },
      album: { title: 'Fixture' },
      duration: 90,
      preview: '',
    });
    const first = track('sc_room_1'),
      second = track('sc_room_2'),
      third = track('sc_room_3');
    const roomSong = (value) => ({
      id: value.id,
      source: value.source,
      title: value.title,
      artist: value.artist.name,
      album: value.album.title,
      duration: value.duration,
    });
    const command = (win, payload) =>
      js(win, 'window.roomProbe.requestRoom(' + JSON.stringify({ op: 'command', payload }) + ')');
    assert.deepEqual(await js(host, 'window.roomProbe.room.playback.queue'), []);
    await js(
      host,
      `window.roomProbe.controls.playTrack(${JSON.stringify(first)},${JSON.stringify([first, second])})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.deepEqual(await js(guest, 'window.roomProbe.room.playback.queue'), []);
    assert.equal(await js(guest, 'window.roomProbe.room.playback.track'), null);
    check('personal playback cannot fill the room queue');
    await command(host, { action: 'enqueue', song: roomSong(first) });
    await command(guest, { action: 'enqueue', song: roomSong(second) });
    await wait(guest, 'window.roomProbe.room.playback.queue.length===1', 'collaborative queue');
    assert.equal(await js(guest, 'window.roomProbe.room.playback.playing'), true);
    check('first addition starts playback and later additions stay queued');
    await wait(host, 'Boolean(window.roomFirstResolveAt)', 'slow stream lookup started');
    await new Promise((resolve) => setTimeout(resolve, 1600));
    for (const listener of windows) {
      assert.equal(await js(listener, 'window.roomProbe.room.playback.preparing'), true);
      assert.equal(await js(listener, 'window.roomProbe.room.playback.position'), 0);
      assert.equal(await js(listener, 'window.roomProbe.audio.isPlaying'), false);
    }
    check('slow stream preparation holds the room clock at zero');
    await wait(
      guest,
      'window.roomProbe.audio.isPlaying&&window.roomProbe.progress.currentTime>.3',
      'guest decoded audio',
    );
    await wait(
      host,
      'window.roomProbe.audio.isPlaying&&window.roomProbe.progress.currentTime>.3',
      'host decoded audio',
    );
    const positions = await Promise.all(
      windows.map((win) => js(win, 'window.roomProbe.controls.getPlaybackTime()')),
    );
    assert.ok(Math.abs(positions[0] - positions[1]) < 1.5, JSON.stringify(positions));
    assert.ok(
      positions.every((position) => position < 2),
      JSON.stringify(positions),
    );
    check('both real decoders follow the shared queue');
    await js(host, 'window.roomProbe.controls.togglePlay()');
    await wait(guest, '!window.roomProbe.audio.isPlaying', 'host pause');
    await js(guest, 'window.roomProbe.controls.togglePlay()');
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(await js(guest, 'window.roomProbe.audio.isPlaying'), false);
    check('main player controls respect host authority');
    await js(host, 'window.roomProbe.controls.seek(12)');
    await wait(guest, 'Math.abs(window.roomProbe.controls.getPlaybackTime()-12)<.8', 'paused seek');
    await command(guest, { action: 'enqueue', song: roomSong(third) });
    await wait(
      host,
      'window.roomProbe.room.playback.queue.some(song=>song.id==="sc_room_3")',
      'guest addition reaches host',
    );
    const removed = await js(
      host,
      'window.roomProbe.room.playback.queue.find(song=>song.id==="sc_room_3").entryId',
    );
    await command(host, { action: 'remove', entryId: removed });
    await wait(
      guest,
      '!window.roomProbe.room.playback.queue.some(song=>song.id==="sc_room_3")',
      'host removal',
    );
    check('guest additions and host removal synchronize');
    await command(host, { action: 'play' });
    await wait(guest, 'window.roomProbe.audio.isPlaying', 'resume');
    await command(host, { action: 'next' });
    await wait(
      guest,
      'window.roomProbe.audio.currentTrack?.id===window.roomProbe.room.playback.track?.id&&window.roomProbe.audio.isPlaying',
      'skip synchronized',
    );
    const currentId = await js(host, 'window.roomProbe.room.playback.track.id');
    await js(host, 'window.roomProbe.setController(false)');
    await wait(guest, '!window.roomProbe.audio.isPlaying', 'stalled host', 9000);
    await js(host, 'window.roomProbe.setController(true)');
    await command(host, { action: 'play' });
    await wait(guest, 'window.roomProbe.audio.isPlaying', 'host recovery');
    check('host heartbeat loss pauses room and host can resume');
    await command(host, { action: 'pause' });
    await js(guest, 'window.roomProbe.requestRoom({op:"leave"})');
    await wait(guest, '!window.roomProbe.audio.isPlaying', 'leave pauses');
    await js(
      guest,
      'window.roomProbe.requestRoom(' +
        JSON.stringify({ op: 'join', payload: { displayName: 'Guest again', invitation } }) +
        ')',
    );
    await wait(
      guest,
      'window.roomProbe.audio.currentTrack?.id===' +
        JSON.stringify(currentId) +
        '&&!window.roomProbe.audio.isPlaying',
      'paused rejoin',
    );
    check('joining paused room prepares correct song');
    await command(host, { action: 'play' });
    await wait(guest, 'window.roomProbe.audio.isPlaying', 'rejoined resume');
    await command(host, { action: 'seek', position: 89 });
    await wait(
      guest,
      'window.roomProbe.room.playback.track===null&&!window.roomProbe.audio.isPlaying',
      'queue exhausted',
      6000,
    );
    check('queue exhaustion stops playback without importing personal songs');
    if (internetMode) {
      await command(guest, { action: 'enqueue', song: roomSong(third) });
      await wait(host, 'window.roomProbe.audio.isPlaying', 'playback before host failure');
      await wait(guest, 'window.roomProbe.audio.isPlaying', 'guest playback before host failure');
    }
    if (internetMode) {
      await js(host, 'window.roomProbe.setController(false)');
      bridges[0].dispose();
    } else relay.kill();
    if (internetMode) {
      await wait(
        guest,
        '!window.roomProbe.audio.isPlaying',
        'stale shared clock pauses during recovery',
        6500,
      );
      check('unconfirmed shared clock pauses audio before transport recovery expires');
    }
    await wait(
      guest,
      'window.roomProbe.room.status==="idle"&&!window.roomProbe.audio.isPlaying',
      'relay failure pauses guest',
      internetMode ? 70000 : 12000,
    );
    check(
      internetMode
        ? 'host transport shutdown exits guest room'
        : 'relay failure pauses guest and exits room',
    );
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log('LISTENING_ROOM_PLAYBACK_PASSED ' + JSON.stringify(report));
    cleanup(0);
  } catch (error) {
    console.error('ROOM_PLAYBACK_FAILED ' + stage, error);
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ ...report, failedStage: stage, error: String(error) }, null, 2),
    );
    cleanup(1);
  }
});
