import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackLogger } from '../src/desktop/main/services/playbackLogger.ts';
import { YouTubeMusicService } from '../src/desktop/main/services/youtubeMusic.ts';
import { YouTubeMusicTransport } from '../src/desktop/main/services/youtubeMusicTransport.ts';
import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';
import { isArtistMatch, isTitleMatch } from '../src/shared/utils/artistParser.ts';
import { isPlayableDirectAudioUrl } from '../src/shared/utils/audioUrlValidator.ts';

test('PlaybackLogger: logs events and retrieves recent history', () => {
  PlaybackLogger.info('Test playback started for Earshot - What Are You Waiting For');
  PlaybackLogger.warn('Test playback stream missing, triggering fallback');
  PlaybackLogger.error('Test playback decode error simulation', { code: 4 });

  const logs = PlaybackLogger.getRecentLogs(10);
  assert.ok(logs.length >= 3, 'Should retain recent logs in ring buffer');

  const infoLog = logs.find((l) => l.includes('Test playback started for Earshot'));
  assert.ok(infoLog, 'Should contain formatted INFO log');
  assert.ok(infoLog.includes('[INFO]'), 'Log line should contain level indicator');

  const warnLog = logs.find((l) => l.includes('Test playback stream missing'));
  assert.ok(warnLog && warnLog.includes('[WARN]'), 'Log line should contain WARN indicator');

  const errLog = logs.find((l) => l.includes('Test playback decode error'));
  assert.ok(errLog && errLog.includes('[ERROR]'), 'Log line should contain ERROR indicator');
});

test('YouTube Music: cleanArtistId strips yt_art_ and preserves core name', () => {
  assert.equal(
    MusicAggregatorService.cleanArtistId('yt_art_UCDUesDHrTBgJtltqaoKW6aA'),
    'UCDUesDHrTBgJtltqaoKW6aA',
  );
  assert.equal(MusicAggregatorService.cleanArtistId('yt_art_earshot'), 'earshot');
  assert.equal(MusicAggregatorService.cleanArtistId('sc_art_2022525143'), '2022525143');
  assert.equal(MusicAggregatorService.cleanArtistId('dz_art_873254114'), '873254114');
});

test('YouTube Music: Artist Matching and Title Matching handles studio variants', () => {
  const candidate = {
    title: 'What Are You Waiting For (Official Audio)',
    artist: { name: 'Earshot' },
    duration: 231,
  };

  assert.ok(isArtistMatch(candidate, 'Earshot'), 'Artist should match Earshot');
  assert.ok(
    isTitleMatch(candidate.title, 'What Are You Waiting For'),
    'Title should match despite (Official Audio)',
  );
});

test('YouTube Music: isDurationAcceptable helper validates track durations', async () => {
  // Test duration tolerance helper
  assert.ok(
    YouTubeMusicService.isDurationAcceptable(231, 230, 25),
    '230s should be acceptable for 231s target',
  );
  assert.ok(
    YouTubeMusicService.isDurationAcceptable(231, 255, 25),
    '255s should be acceptable for 231s target',
  );
  assert.ok(
    !YouTubeMusicService.isDurationAcceptable(231, 100, 25),
    '100s snippet should be rejected for 231s target',
  );
  assert.ok(
    !YouTubeMusicService.isDurationAcceptable(231, 900, 25),
    '900s mix should be rejected for 231s target',
  );
});

test('MusicAggregatorService: Returns empty stream without searching alternatives when track source provides no stream', async () => {
  // Mock track representing a purchase-only Bandcamp track (like Earshot's album tracks)
  const purchaseOnlyTrack = {
    id: 'bc_2022525143_3671729041_t',
    title: 'What Are You Waiting For',
    artist: { name: 'Earshot' },
    preview: '', // empty because Bandcamp streaming_url is null
    duration: 231,
    source: 'bandcamp',
  };

  // getFullStreamUrl should NOT search for alternatives and return empty string
  const streamUrl = await MusicAggregatorService.getFullStreamUrl(purchaseOnlyTrack);
  assert.equal(streamUrl, '', 'Should return empty string without substituting alternative tracks');
});

test('YouTube Music Kopuz Filters: Compact Protobuf search filter tokens', () => {
  assert.equal(YouTubeMusicService.PARAMS.SONGS, 'EgWKAQIIAWoMEAMQBBAJEAoQDhAV');
  assert.equal(YouTubeMusicService.PARAMS.VIDEOS, 'EgWKAQIQAWoMEAMQBBAJEAoQDhAV');
  assert.equal(YouTubeMusicService.PARAMS.ALBUMS, 'EgWKAQIYAWoMEAMQBBAJEAoQDhAV');
  assert.equal(YouTubeMusicService.PARAMS.ARTISTS, 'EgWKAQIgAWoMEAMQBBAJEAoQDhAV');
});

test('YouTube Music InnerTube: Visitor data fetch and caching with mock', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ responseContext: { visitorData: 'CgtNMGNLaFBY' } }),
  }));

  const visitorData = await YouTubeMusicService.getVisitorData();
  assert.equal(visitorData, 'CgtNMGNLaFBY');
});

test('YouTube Music Direct Audio Stream: Handles empty or invalid inputs gracefully', async () => {
  const emptyStream = await YouTubeMusicService.resolveDirectAudioStream('');
  assert.equal(emptyStream, '');

  const emptyTrackStream = await YouTubeMusicService.getFullStreamUrl(null);
  assert.equal(emptyTrackStream, '');
});

test('isPlayableDirectAudioUrl: strictly validates playable audio streams and rejects HTML pages & API endpoints', () => {
  // Valid streams
  assert.ok(
    isPlayableDirectAudioUrl(
      'https://rr2---sn-8ph2xajvh-3hfl.googlevideo.com/videoplayback?expire=1789976086&id=123',
    ),
  );
  assert.ok(
    isPlayableDirectAudioUrl(
      'https://playback.media-streaming.soundcloud.cloud/agqsHwM2OJLw/aac_160k/stream.mp3',
    ),
  );
  assert.ok(isPlayableDirectAudioUrl('https://t4.bcbits.com/stream/track.mp3?token=12345'));
  assert.ok(isPlayableDirectAudioUrl('blob:http://localhost:5173/abcd-1234-uuid'));
  assert.ok(isPlayableDirectAudioUrl('data:audio/mp3;base64,SUQzBAAAAAAA...'));

  // Invalid: Web pages (these crash FFmpegDemuxer if passed to <audio src>)
  assert.ok(!isPlayableDirectAudioUrl('https://www.youtube.com/watch?v=4E--9pikEx0'));
  assert.ok(!isPlayableDirectAudioUrl('https://youtu.be/4E--9pikEx0'));
  assert.ok(!isPlayableDirectAudioUrl('https://www.youtube.com/embed/4E--9pikEx0'));
  assert.ok(!isPlayableDirectAudioUrl('https://music.youtube.com/watch?v=4E--9pikEx0'));
  assert.ok(!isPlayableDirectAudioUrl('https://api-v2.soundcloud.com/tracks/12345/stream'));

  // Invalid: Empty / non-URLs
  assert.ok(!isPlayableDirectAudioUrl(''));
  assert.ok(!isPlayableDirectAudioUrl('   '));
  assert.ok(!isPlayableDirectAudioUrl('yt_4E--9pikEx0'));
  assert.ok(!isPlayableDirectAudioUrl(null));
  assert.ok(!isPlayableDirectAudioUrl(undefined));
});

test('YouTube Music Direct Audio Stream: Paywalled track resolution is logged cleanly and returns empty without loop', async (t) => {
  const messages = [];
  let requests = 0;
  t.mock.method(PlaybackLogger, 'warn', (message) => messages.push(message));
  t.mock.method(YouTubeMusicService, 'getVisitorData', async () => '');
  t.mock.method(YouTubeMusicTransport, 'postPlayer', async () => {
    requests++;
    return Response.json({
      playabilityStatus: {
        status: 'UNPLAYABLE',
        reason: 'This video is only available to Music Premium members',
      },
    });
  });

  const stream = await YouTubeMusicService.resolveDirectAudioStream('4E--9pikEx0');
  assert.equal(stream, '', 'Paywalled track should return empty stream without throwing');

  assert.equal(requests, 1, 'Premium denial must not retry');
  assert.ok(
    messages.some((message) => message.includes('4E--9pikEx0') && message.includes('UNPLAYABLE')),
    'The provider denial must be logged',
  );
});

test('PlaybackLogger: Rotates log file to .old.log when file exceeds size limit', async () => {
  const fs = await import('fs');
  const path = await import('path');
  const logPath = PlaybackLogger.getLogFilePath();
  assert.ok(logPath, 'Log file path should be defined');

  // Verify rotateFileIfNeeded rotates file to .old.log
  const testDir = path.dirname(logPath);
  const testLog = path.join(testDir, 'test_rotation_sample.log');
  const testOldLog = path.join(testDir, 'test_rotation_sample.old.log');

  try {
    // Write 1.1MB dummy file
    const largeContent = 'A'.repeat(1024 * 1024 + 100);
    fs.writeFileSync(testLog, largeContent, 'utf8');

    // Call rotateFileIfNeeded
    PlaybackLogger['rotateFileIfNeeded'](testLog);

    assert.ok(fs.existsSync(testOldLog), 'Rotated .old.log file should exist');
    assert.ok(fs.existsSync(testLog), 'Fresh .log file should exist with rotation header');
    const freshContent = fs.readFileSync(testLog, 'utf8');
    assert.ok(freshContent.includes('--- Log rotated at'), 'Fresh log should have rotation header');
  } finally {
    if (fs.existsSync(testLog)) fs.unlinkSync(testLog);
    if (fs.existsSync(testOldLog)) fs.unlinkSync(testOldLog);
  }
});
