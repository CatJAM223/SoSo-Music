import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildLocalListenUrl, parseLocalListenTrack } from '../src/shared/utils/localListenLink.ts';
import { LocalListenServer } from '../src/desktop/main/services/localListenServer.ts';
import { DiscordRPCService } from '../src/desktop/main/services/discordRpc.ts';
const song = {
  trackId: 'yt_W0LiTBNjJ_o',
  source: 'youtube',
  title: 'попал',
  artist: 'tewiq',
  duration: 106,
};
const request = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });

test('Listen links carry provider identity, fit Discord limits, and reject unsupported identities', () => {
  const link = buildLocalListenUrl({
    ...song,
    title: '🎶'.repeat(120),
    artist: 'Исполнитель'.repeat(100),
    preview: 'https://secret.invalid/token',
  });
  assert.ok(link.length <= 512);
  assert.equal(parseLocalListenTrack(new URL(link)).id, song.trackId);
  assert.ok(!link.includes('secret'));
  assert.equal(buildLocalListenUrl({ ...song, trackId: '../../file' }), null);
  assert.equal(buildLocalListenUrl({ ...song, source: 'deezer' }), null);
  assert.equal(buildLocalListenUrl(song, 'https://foreign.invalid'), null);
  assert.equal(
    buildLocalListenUrl({ ...song, trackId: 'sc_123456', source: 'soundcloud' }) !== null,
    true,
  );
});

test('Discord button is present only when local receiver is available and the track is shareable', () => {
  const build = DiscordRPCService.buildActivityPayload;
  try {
    DiscordRPCService.setListenOrigin(null);
    assert.equal(build({ ...song, isPlaying: true }).buttons, undefined);
    DiscordRPCService.setListenOrigin('http://127.0.0.1:47836');
    const buttons = build({ ...song, isPlaying: true }).buttons;
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].label, 'Слушать в SoSo Music');
    assert.equal(parseLocalListenTrack(new URL(buttons[0].url)).id, song.trackId);
    assert.equal(build({ ...song, trackId: 'invalid', isPlaying: true }).buttons, undefined);
  } finally {
    DiscordRPCService.setListenOrigin(null);
  }
});

test('Loopback page opens the exact song once after a click; foreign origins and host headers cannot trigger playback', async () => {
  const server = new LocalListenServer(),
    received = [];
  const origin = await server.start((track) => received.push(track), 0);
  assert.ok(origin);
  try {
    const link = buildLocalListenUrl({ ...song, title: '<script>alert(1)</script>' }, origin);
    const page = await request(link);
    assert.equal(page.status, 200);
    assert.equal(received.length, 0);
    assert.ok(page.body.includes('&lt;script&gt;'));
    assert.ok(page.headers['content-security-policy'].includes("frame-ancestors 'none'"));
    const token = page.body.match(/\/play\/([a-f0-9]{48})/)[1];
    assert.equal(
      (
        await request(origin + '/play/' + token, {
          method: 'POST',
          headers: { Origin: 'https://foreign.invalid', 'X-SoSo-Listen': '1' },
        })
      ).status,
      403,
    );
    assert.equal((await request(link, { headers: { Host: 'foreign.invalid' } })).status, 403);
    assert.equal((await request(origin + '/listen?id=../file&source=youtube')).status, 400);
    assert.equal(
      (
        await request(origin + '/play/' + token, {
          method: 'POST',
          headers: { Origin: origin, 'X-SoSo-Listen': '1' },
        })
      ).status,
      204,
    );
    assert.equal(received.length, 1);
    assert.equal(received[0].id, song.trackId);
    assert.equal(received[0].preview, '');
    assert.equal(
      (
        await request(origin + '/play/' + token, {
          method: 'POST',
          headers: { Origin: origin, 'X-SoSo-Listen': '1' },
        })
      ).status,
      410,
    );
  } finally {
    server.stop();
  }
});

test('An occupied listen port disables the receiver without interfering with another process', async () => {
  const owner = new LocalListenServer(),
    second = new LocalListenServer();
  const origin = await owner.start(() => {}, 0);
  try {
    assert.equal(await second.start(() => {}, Number(new URL(origin).port)), null);
    assert.ok(owner.origin);
  } finally {
    owner.stop();
    second.stop();
  }
});

test('Discord handoff keeps the YouTube Music yt3 artwork through both link types and the loopback receiver', async () => {
  const cover =
    'https://yt3.googleusercontent.com/' + 'album-artwork'.repeat(6) + '=w544-h544-l90-rj';
  const data = {
    ...song,
    title: 'дырки в штанах',
    artist: 'madk1d',
    coverUrl: cover,
    isPlaying: true,
  };
  const received = [],
    server = new LocalListenServer();
  const origin = await server.start((track) => received.push(track), 0);
  try {
    const { parseSoSoListenTrack } = await import('../src/shared/utils/localListenLink.ts');
    for (const direct of [true, false]) {
      DiscordRPCService.setDirectListenEnabled(direct);
      DiscordRPCService.setListenOrigin(origin);
      const link = DiscordRPCService.buildActivityPayload(data).buttons[0].url;
      const parsed = direct ? parseSoSoListenTrack(link) : parseLocalListenTrack(new URL(link));
      assert.equal(parsed.cover_url, cover);
      assert.equal(parsed.album.cover_medium, cover);
      if (!direct) {
        const page = await request(link);
        const token = page.body.match(/\/play\/([a-f0-9]{48})/)[1];
        const embedded = page.body.match(/id="direct" href="([^"]+)"/)[1].replaceAll('&amp;', '&');
        assert.equal(parseSoSoListenTrack(embedded).cover_url, cover);
        await request(origin + '/play/' + token, {
          method: 'POST',
          headers: { Origin: origin, 'X-SoSo-Listen': '1' },
        });
        assert.equal(received[0].cover_url, cover);
      }
    }
    for (const bad of [
      'https://yt3.googleusercontent.com.evil.test/image',
      'https://evil.yt3.googleusercontent.com/image',
      'http://yt3.googleusercontent.com/image',
    ]) {
      assert.notEqual(
        parseLocalListenTrack(new URL(buildLocalListenUrl({ ...data, coverUrl: bad }))).cover_url,
        bad,
      );
    }
  } finally {
    server.stop();
    DiscordRPCService.setDirectListenEnabled(false);
    DiscordRPCService.setListenOrigin(null);
  }
});
