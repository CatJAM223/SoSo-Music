import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundCloudService } from '../src/desktop/main/services/soundcloud.ts';
import {
  LyricsService,
  cleanLyricText,
  buildKaraokeLinesWithBreaks,
} from '../src/desktop/main/services/lyricsService.ts';
import { WaveEngine } from '../src/desktop/main/services/waveEngine.ts';

const transformSCTrack = SoundCloudService.transformSCTrack.bind(SoundCloudService);
const parseLrc = LyricsService.parseLrc.bind(LyricsService);
const findBestSoundCloudMatch = SoundCloudService.findBestTrackMatch.bind(SoundCloudService);

// --- 1. SOUNDCLOUD HARDCORE EDGE CASES ---

test('Hardcore SC: Tracks with only Go+ encrypted or dead legacy transcodings are safely handled', () => {
  const drmOnlyTrack = {
    id: 258954403,
    title: 'Smells Like Teen Spirit',
    duration: 301499,
    policy: 'MONETIZE',
    monetization_model: 'AD_SUPPORTED',
    media: {
      transcodings: [
        {
          protocol: 'cbc-encrypted-hls',
          format: { protocol: 'cbc-encrypted-hls', mime_type: 'audio/mp4' },
          url: 'https://api-v2.soundcloud.com/media/encrypted1',
        },
        {
          protocol: 'ctr-encrypted-hls',
          format: { protocol: 'ctr-encrypted-hls', mime_type: 'audio/mp4' },
          url: 'https://api-v2.soundcloud.com/media/encrypted2',
        },
        {
          protocol: 'hls',
          format: { protocol: 'hls', mime_type: 'audio/mpeg' },
          url: 'https://api-v2.soundcloud.com/media/dead-legacy',
          is_legacy_transcoding: true,
        },
      ],
    },
  };

  const transformed = transformSCTrack(drmOnlyTrack);
  assert.ok(transformed);
  assert.equal(transformed.id, 258954403);
  assert.equal(transformed.title, 'Smells Like Teen Spirit');
  assert.equal(transformed.duration, 301);
});

test('Hardcore SC: Complex artist-title parsing and HD artwork URL replacements', () => {
  const rawItem = {
    id: 987654,
    title: 'Nirvana - Smells Like Teen Spirit (Official Audio)',
    duration: 301000,
    artwork_url: 'https://i1.sndcdn.com/artworks-abcd-large.jpg',
    user: {
      id: 111,
      username: 'NirvanaOfficial',
      avatar_url: 'https://i1.sndcdn.com/avatars-111-large.jpg',
    },
    publisher_metadata: { artist: 'Nirvana', album_title: 'Nevermind' },
    media: {
      transcodings: [
        {
          format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
          url: 'https://api-v2/stream/progressive',
        },
      ],
    },
  };

  const track = transformSCTrack(rawItem);
  assert.ok(track);
  assert.equal(track.artist.name, 'Nirvana');
  assert.equal(track.title, 'Smells Like Teen Spirit (Official Audio)');
  assert.equal(track.album.title, 'Nevermind');
  assert.equal(track.album.cover_medium, 'https://i1.sndcdn.com/artworks-abcd-t500x500.jpg');
});

test('Hardcore SC: Multi-hyphen and bracketed artist extraction', () => {
  const multiHyphen = {
    id: 112233,
    title: 'AC/DC - Highway to Hell - Live at River Plate',
    duration: 210000,
    user: { id: 22, username: 'ACDC' },
    media: {
      transcodings: [{ format: { protocol: 'progressive' }, url: 'https://api-v2/prog' }],
    },
  };

  const track = transformSCTrack(multiHyphen);
  assert.ok(track);
  assert.equal(track.artist.name, 'AC/DC');
  assert.equal(track.title, 'Highway to Hell - Live at River Plate');
});

// --- 2. MUSIC AGGREGATOR MATCHER HARDCORE CASES ---

test('Hardcore Matcher: Rejects unwanted covers/slowed/nightcore unless requested', () => {
  const target = {
    title: 'Smells Like Teen Spirit',
    artist: { name: 'Nirvana' },
    duration: 301,
  };

  const candidates = [
    {
      id: 1,
      title: 'Nirvana - Smells Like Teen Spirit (Slowed + Reverb)',
      duration: 350,
      artist: 'Nirvana',
    },
    {
      id: 2,
      title: 'Nirvana - Smells Like Teen Spirit (Guitar Cover)',
      duration: 301,
      artist: 'Guitarist99',
    },
    {
      id: 3,
      title: 'Nirvana - Smells Like Teen Spirit (Nightcore Remix)',
      duration: 250,
      artist: 'NightcoreGod',
    },
    {
      id: 4,
      title: 'Nirvana - Smells Like Teen Spirit (Original Studio Track)',
      duration: 301,
      artist: 'Nirvana',
    },
  ];

  const matched = findBestSoundCloudMatch(target, candidates);
  assert.ok(matched);
  assert.equal(matched.id, 4);
});

test('Hardcore Matcher: Matches featuring artists cleanly', () => {
  const target = {
    title: 'Save Your Tears (feat. Ariana Grande)',
    artist: { name: 'The Weeknd, Ariana Grande' },
    duration: 191,
  };

  const candidates = [
    { id: 10, title: 'The Weeknd - Save Your Tears', duration: 215, artist: 'The Weeknd' },
    {
      id: 20,
      title: 'The Weeknd - Save Your Tears ft. Ariana Grande',
      duration: 191,
      artist: 'The Weeknd',
    },
  ];

  const matched = findBestSoundCloudMatch(target, candidates);
  assert.ok(matched);
  assert.equal(matched.id, 20);
});

// --- 3. LYRICS & KARAOKE PARSING HARDCORE CASES ---

test('Hardcore Lyrics: Enhanced LRC word tags and HTML entities are perfectly sanitized', () => {
  const dirtyLrc = `
[ti:Smells Like Teen Spirit]
[ar:Nirvana]
[00:25.10] <00:25.10> Load <00:25.60> up <00:26.00> on <00:26.40> guns, <00:27.00> bring <00:27.50> your <00:28.00> friends
[00:29.80] It&apos;s fun to lose &amp; to pretend
[00:34.250] She&apos;s over-bored &quot;and self-assured&quot;
[00:38.90] Oh no, I know a dirty word
`;

  const parsed = parseLrc(dirtyLrc);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].text, 'Load up on guns, bring your friends');
  assert.equal(parsed[0].time, 25.1);
  assert.equal(parsed[1].text, "It's fun to lose & to pretend");
  assert.equal(parsed[1].time, 29.8);
  assert.equal(parsed[2].text, 'She\'s over-bored "and self-assured"');
  assert.equal(parsed[2].time, 34.25);
  assert.equal(parsed[3].text, 'Oh no, I know a dirty word');
  assert.equal(parsed[3].time, 38.9);
});

test('Hardcore Karaoke: buildKaraokeLinesWithBreaks inserts intro and mid-song instrumental breaks', () => {
  const lyrics = [
    { time: 10.0, text: 'First verse starts after a long intro' },
    { time: 14.0, text: 'Second verse follows immediately' },
    { time: 24.5, text: 'Third verse starts after an 10.5-second guitar solo' },
  ];

  const karaoke = buildKaraokeLinesWithBreaks(lyrics);
  assert.equal(karaoke.length, 5); // intro break + line 0 + line 1 + mid break + line 2

  // Intro break (time: 0, text: '• • •')
  assert.equal(karaoke[0].isInstrumentalBreak, true);
  assert.equal(karaoke[0].time, 0);
  assert.equal(karaoke[0].text, '• • •');

  // Line 0
  assert.equal(karaoke[1].isInstrumentalBreak, false);
  assert.equal(karaoke[1].text, 'First verse starts after a long intro');

  // Line 1
  assert.equal(karaoke[2].isInstrumentalBreak, false);

  // Mid-song instrumental break between 14.0 and 24.5 (gap > 8s)
  assert.equal(karaoke[3].isInstrumentalBreak, true);
  assert.equal(karaoke[3].time, 14.0 + 1.5);
  assert.equal(karaoke[3].text, '• • •');

  // Line 2
  assert.equal(karaoke[4].isInstrumentalBreak, false);
  assert.equal(karaoke[4].text, 'Third verse starts after an 10.5-second guitar solo');
});

test('Hardcore WaveEngine: Filter long mixes and podcasts', () => {
  assert.equal(
    WaveEngine.isMixOrPodcast({ title: 'Lofi Hip Hop Radio - 24/7 Chill Beats 1 hour loop' }),
    true,
  );
  assert.equal(
    WaveEngine.isMixOrPodcast({ title: 'Boris Brejcha - Live Set at Tomorrowland 2026' }),
    true,
  );
  assert.equal(WaveEngine.isMixOrPodcast({ title: 'Nirvana - Nevermind Full Album HQ' }), true);
  assert.equal(WaveEngine.isMixOrPodcast({ title: 'Nirvana - Smells Like Teen Spirit' }), false);
  assert.equal(WaveEngine.isMixOrPodcast({ title: 'The Weeknd - Blinding Lights' }), false);
});
