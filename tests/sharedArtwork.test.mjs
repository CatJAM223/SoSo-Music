import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalListenUrl,
  buildSoSoListenUrl,
  parseLocalListenTrack,
  parseSoSoListenTrack,
} from '../src/shared/utils/localListenLink.ts';
import { DiscordRPCService } from '../src/desktop/main/services/discordRpc.ts';
const data = {
  trackId: 'yt_W0LiTBNjJ_o',
  source: 'youtube',
  title: 'попал',
  artist: 'tewiq',
  duration: 106,
};

test('Shared artwork: YouTube links restore artwork from exact ID, including old links', () => {
  for (const link of [buildLocalListenUrl(data), buildSoSoListenUrl(data)]) {
    const track = link.startsWith('http')
      ? parseLocalListenTrack(new URL(link))
      : parseSoSoListenTrack(link);
    assert.equal(track.album.cover_xl, 'https://i.ytimg.com/vi/W0LiTBNjJ_o/hqdefault.jpg');
    assert.equal(track.cover_url, track.album.cover_big);
    assert.equal(track.preview, '');
  }
});
test('Shared artwork: original cover survives links for both providers', () => {
  for (const [source, trackId, coverUrl] of [
    ['youtube', data.trackId, 'https://lh3.googleusercontent.com/test-cover=w544-h544-l90-rj'],
    ['soundcloud', 'sc_654184550', 'https://i1.sndcdn.com/artworks-test-t500x500.jpg'],
  ]) {
    const track = parseSoSoListenTrack(buildSoSoListenUrl({ ...data, source, trackId, coverUrl }));
    assert.equal(track.album.cover_xl, coverUrl);
    assert.equal(track.album.cover_medium, coverUrl);
  }
});
test('Shared artwork: unsupported image URLs and excessive URL length cannot enter shared links', () => {
  for (const coverUrl of [
    'https://private.invalid/secret',
    'http://i.ytimg.com/cover',
    'https://i.ytimg.com.evil.invalid/cover',
    'https://user:pass@i.ytimg.com/cover',
    'file:///secret',
    'https://i.ytimg.com:8443/cover',
    'https://i.ytimg.com/cover#token',
    'https://i.ytimg.com/' + 'a'.repeat(2000),
  ]) {
    const link = buildSoSoListenUrl({ ...data, coverUrl });
    assert.ok(link.length <= 512);
    assert.ok(!link.includes('cover='));
    const track = parseSoSoListenTrack(
      buildSoSoListenUrl(data) + '&cover=' + encodeURIComponent(coverUrl),
    );
    assert.equal(track.album.cover_xl, 'https://i.ytimg.com/vi/W0LiTBNjJ_o/hqdefault.jpg');
  }
  const long = buildSoSoListenUrl({
    ...data,
    title: 'Я'.repeat(120),
    artist: 'Я'.repeat(100),
    coverUrl: 'https://lh3.googleusercontent.com/' + 'a'.repeat(400),
  });
  assert.ok(long.length <= 512);
  assert.equal(parseSoSoListenTrack(long).id, data.trackId);
});
test('Discord direct button: a registered player uses its own protocol even without an HTTP receiver', () => {
  try {
    DiscordRPCService.setListenOrigin(null);
    DiscordRPCService.setDirectListenEnabled(true);
    const payload = DiscordRPCService.buildActivityPayload({
      ...data,
      isPlaying: true,
      coverUrl: 'https://i.ytimg.com/vi/W0LiTBNjJ_o/hqdefault.jpg',
    });
    assert.ok(payload.buttons[0].url.startsWith('sosomusic://listen?'));
    assert.equal(parseSoSoListenTrack(payload.buttons[0].url).id, data.trackId);
    assert.ok(parseSoSoListenTrack(payload.buttons[0].url).album.cover_xl);
    assert.equal(
      DiscordRPCService.buildActivityPayload({ ...data, isPlaying: true, trackId: 'bad' }).buttons,
      undefined,
    );
    DiscordRPCService.setDirectListenEnabled(false);
    assert.equal(
      DiscordRPCService.buildActivityPayload({ ...data, isPlaying: true }).buttons,
      undefined,
    );
  } finally {
    DiscordRPCService.setDirectListenEnabled(false);
    DiscordRPCService.setListenOrigin(null);
  }
});
