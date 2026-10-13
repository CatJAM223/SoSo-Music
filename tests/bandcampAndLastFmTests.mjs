import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTrackSource } from '../src/shared/utils/formatters.ts';
import { parsePlaylistPanelItem } from '../src/shared/services/parsers/youtubeMusicParser.ts';
import { LastFmService } from '../src/desktop/main/services/lastfm.ts';
import { LyricsService } from '../src/desktop/main/services/lyricsService.ts';

test('Formatters: detectTrackSource identifies tracks, URLs and IDs', () => {
  assert.equal(detectTrackSource({ id: 'sc_12345' }), 'soundcloud');
  assert.equal(detectTrackSource({ id: 'yt_abc123' }), 'youtube');
  assert.equal(detectTrackSource({ source: 'soundcloud' }), 'soundcloud');
  assert.equal(detectTrackSource({ source: 'youtube' }), 'youtube');
});

test('YouTube Music Parser: Radio tracks parsing with parsePlaylistPanelItem', () => {
  const panelItem = {
    title: { runs: [{ text: 'Continuum' }] },
    longBylineText: {
      runs: [{ text: 'Resonance' }],
    },
    lengthText: {
      runs: [{ text: '3:45' }],
    },
    thumbnail: {
      thumbnails: [
        { url: 'https://lh3.googleusercontent.com/abc=w120-h120' },
        { url: 'https://lh3.googleusercontent.com/abc=w544-h544' },
      ],
    },
    navigationEndpoint: {
      watchEndpoint: {
        videoId: 'a1b2c3d4e5f',
      },
    },
  };

  const parsed = parsePlaylistPanelItem(panelItem);
  assert.ok(parsed);
  assert.equal(parsed.id, 'yt_a1b2c3d4e5f');
  assert.equal(parsed.title, 'Continuum');
  assert.equal(parsed.artist?.name, 'Resonance');
  assert.equal(parsed.duration, 225);
  assert.equal(parsed.source, 'youtube');
  assert.ok(parsed.album?.cover_big?.includes('w544-h544'));
});

test('Last.fm: Bio sanitization using production LastFmService.cleanBioText', () => {
  const rawBio =
    'Alternative rock band from Seattle. <a href="https://www.last.fm/music/Nirvana">Read more on Last.fm</a>. User-contributed text is available under CC-BY-SA.';
  const cleaned = LastFmService.cleanBioText(rawBio);

  assert.ok(!cleaned.includes('Read more on Last.fm'));
  assert.ok(!cleaned.includes('<a'));
  assert.ok(cleaned.startsWith('Alternative rock band from Seattle.'));
});

test('Lyrics Fallback: Plain-text parsing using production LyricsService.parsePlainLyrics', () => {
  const plainOvh = `[Verse 1]
Hello darkness, my old friend
I've come to talk with you again
Because a vision softly creeping
Left its seeds while I was sleeping`;

  const parsedLines = LyricsService.parsePlainLyrics(plainOvh, 180);

  assert.ok(Array.isArray(parsedLines));
  assert.ok(parsedLines.length >= 4);
  assert.equal(parsedLines[0].text, 'Hello darkness, my old friend');
  assert.equal(parsedLines[3].text, 'Left its seeds while I was sleeping');
});
