import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMojibake,
  fixMojibake,
  detectTrackSource,
  formatTime,
  formatTotalDuration,
  getCoverUrl,
} from '../src/shared/utils/formatters.ts';
import { DEFAULT_COVER_SVG_DATA_URI } from '../src/shared/utils/placeholder.ts';

// ---------------------------------------------------------
// 1. MOJIBAKE DETECTION (isMojibake)
// ---------------------------------------------------------

test('Mojibake: Detects Windows-1251 misdecoded as Latin-1 / ISO-8859-1', () => {
  // Classic SoundCloud Russian punk/rock tags with CP1251 decoded as Latin-1
  assert.equal(isMojibake('Ãðàæäàíñêàÿ Îáîðîíà'), true, 'Should detect Гражданская Оборона');
  assert.equal(isMojibake('Íåêðîôèëèÿ'), true, 'Should detect Некрофилия');
  assert.equal(isMojibake('Ïîñåâ'), true, 'Should detect Посев');
  assert.equal(isMojibake('Âñå èäåò ïî ïëàíó'), true, 'Should detect Все идет по плану');
  assert.equal(isMojibake('Àðìèÿ Âëàñîâà'), true, 'Should detect Армия Власова');
  assert.equal(isMojibake('Êîììóíèçì'), true, 'Should detect Коммунизм');
  assert.equal(isMojibake('Òîòàëèòàðèçì'), true, 'Should detect Тоталитаризм');
  assert.equal(isMojibake('Ïðîäàâåö îòâåñîâ'), true, 'Should detect Продавец отвесов');
});

test('Mojibake: Rejects clean Russian Cyrillic (never false-positive clean Russian)', () => {
  assert.equal(isMojibake('Гражданская Оборона'), false);
  assert.equal(isMojibake('Некрофилия'), false);
  assert.equal(isMojibake('Посев'), false);
  assert.equal(isMojibake('Кино'), false);
  assert.equal(isMojibake('Сектор Газа'), false);
  assert.equal(isMojibake('Король и Шут'), false);
  assert.equal(isMojibake('Ария'), false);
  assert.equal(isMojibake('Земфира'), false);
  assert.equal(isMojibake('Егор Летов'), false);
});

test('Mojibake: Preserves authentic Western names with European diacritics', () => {
  // Western artists with umlauts, acutes, tildes, accents
  assert.equal(isMojibake('Björk'), false, 'Björk must not be flagged as mojibake');
  assert.equal(isMojibake('Beyoncé'), false, 'Beyoncé must not be flagged as mojibake');
  assert.equal(isMojibake('Mötley Crüe'), false, 'Mötley Crüe must not be flagged as mojibake');
  assert.equal(isMojibake('Sigur Rós'), false, 'Sigur Rós must not be flagged as mojibake');
  assert.equal(isMojibake('Motörhead'), false, 'Motörhead must not be flagged as mojibake');
  assert.equal(isMojibake('Queensrÿche'), false, 'Queensrÿche must not be flagged as mojibake');
  assert.equal(isMojibake('Röyksopp'), false, 'Röyksopp must not be flagged as mojibake');
  assert.equal(isMojibake('Céline Dion'), false, 'Céline Dion must not be flagged as mojibake');
  assert.equal(isMojibake('Zoë'), false, 'Zoë must not be flagged as mojibake');
  assert.equal(isMojibake('Amélie'), false, 'Amélie must not be flagged as mojibake');
  assert.equal(isMojibake('José González'), false, 'José González must not be flagged as mojibake');
  assert.equal(
    isMojibake("Sinéad O'Connor"),
    false,
    "Sinéad O'Connor must not be flagged as mojibake",
  );
});

test('Mojibake: Rejects clean English ASCII and empty inputs', () => {
  assert.equal(isMojibake('Radiohead'), false);
  assert.equal(isMojibake('The Weeknd'), false);
  assert.equal(isMojibake('Linkin Park'), false);
  assert.equal(isMojibake('Daft Punk'), false);
  assert.equal(isMojibake(''), false);
  assert.equal(isMojibake('   '), false);
  assert.equal(isMojibake(null), false);
  assert.equal(isMojibake(undefined), false);
});

// ---------------------------------------------------------
// 2. MOJIBAKE REPAIR (fixMojibake)
// ---------------------------------------------------------

test('Mojibake: Repairs corrupted Russian strings back to clean Cyrillic', () => {
  assert.equal(fixMojibake('Ãðàæäàíñêàÿ Îáîðîíà'), 'Гражданская Оборона');
  assert.equal(fixMojibake('Íåêðîôèëèÿ'), 'Некрофилия');
  assert.equal(fixMojibake('Ïîñåâ'), 'Посев');
  assert.equal(fixMojibake('Âñå èäåò ïî ïëàíó'), 'Все идет по плану');
  assert.equal(fixMojibake('Àðìèÿ Âëàñîâà'), 'Армия Власова');
  assert.equal(fixMojibake('Êîììóíèçì'), 'Коммунизм');
  assert.equal(fixMojibake('Òîòàëèòàðèçì'), 'Тоталитаризм');
  assert.equal(fixMojibake('Ïðîäàâåö îòâåñîâ'), 'Продавец отвесов');
});

test('Mojibake: fixMojibake leaves genuine Western names intact', () => {
  assert.equal(fixMojibake('Björk'), 'Björk');
  assert.equal(fixMojibake('Beyoncé'), 'Beyoncé');
  assert.equal(fixMojibake('Mötley Crüe'), 'Mötley Crüe');
  assert.equal(fixMojibake('Sigur Rós'), 'Sigur Rós');
  assert.equal(fixMojibake('Motörhead'), 'Motörhead');
  assert.equal(fixMojibake('Queensrÿche'), 'Queensrÿche');
  assert.equal(fixMojibake('Röyksopp'), 'Röyksopp');
  assert.equal(fixMojibake('Céline Dion'), 'Céline Dion');
  assert.equal(fixMojibake('José González'), 'José González');
});

test('Mojibake: fixMojibake leaves standard ASCII and clean Cyrillic intact', () => {
  assert.equal(fixMojibake('Гражданская Оборона'), 'Гражданская Оборона');
  assert.equal(fixMojibake('Некрофилия'), 'Некрофилия');
  assert.equal(fixMojibake('Radiohead - Creep'), 'Radiohead - Creep');
  assert.equal(fixMojibake('The Weeknd - Blinding Lights'), 'The Weeknd - Blinding Lights');
  assert.equal(fixMojibake(''), '');
  assert.equal(fixMojibake(null), '');
  assert.equal(fixMojibake(undefined), '');
});

// ---------------------------------------------------------
// 3. TRACK SOURCE DETECTION & FORMATTERS
// ---------------------------------------------------------

test('Formatters: detectTrackSource identifies YouTube, SoundCloud, and Deezer accurately', () => {
  // YouTube Music
  assert.equal(detectTrackSource({ source: 'youtube' }), 'youtube');
  assert.equal(detectTrackSource({ id: 'yt_dQw4w9WgXcQ' }), 'youtube');
  assert.equal(
    detectTrackSource({ preview_url: 'https://googlevideo.com/videoplayback?id=123' }),
    'youtube',
  );
  assert.equal(detectTrackSource({ preview: 'https://www.youtube.com/watch?v=123' }), 'youtube');
  assert.equal(
    detectTrackSource({ cover_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }),
    'youtube',
  );
  assert.equal(
    detectTrackSource({ cover: 'https://lh3.googleusercontent.com/abc=w544-h544' }),
    'youtube',
  );
  assert.equal(detectTrackSource({ id: '123', source: 'youtube' }), 'youtube');

  // SoundCloud
  assert.equal(detectTrackSource({ source: 'soundcloud' }), 'soundcloud');
  assert.equal(detectTrackSource({ id: 'sc_123456789' }), 'soundcloud');
  assert.equal(
    detectTrackSource({
      preview: 'https://api-v2.soundcloud.com/media/tracks:123/stream/progressive',
    }),
    'soundcloud',
  );
  assert.equal(
    detectTrackSource({
      preview_url: 'https://api-v2.soundcloud.com/media/tracks:123/stream/progressive',
    }),
    'soundcloud',
  );
  assert.equal(
    detectTrackSource({ cover_url: 'https://i1.sndcdn.com/artworks-000123-large.jpg' }),
    'soundcloud',
  );
  assert.equal(detectTrackSource({ id: '123', source: 'soundcloud' }), 'soundcloud');
  assert.equal(detectTrackSource({ id: '123456', title: 'Track' }), 'soundcloud');
  assert.equal(
    detectTrackSource({
      deezer_id: '850299820',
      cover_url: 'https://i1.sndcdn.com/artworks-123-t500x500.jpg',
    }),
    'soundcloud',
  );

  // Legacy Deezer
  assert.equal(detectTrackSource({ source: 'deezer' }), 'deezer');
  assert.equal(
    detectTrackSource({ preview_url: 'https://cdnt-preview.dzcdn.net/123.mp3' }),
    'deezer',
  );
  assert.equal(
    detectTrackSource({ cover_url: 'https://cdn-images.dzcdn.net/images/cover/123.jpg' }),
    'deezer',
  );
  assert.equal(
    detectTrackSource({
      deezer_id: '1596890022',
      cover_url: 'https://cdn-images.dzcdn.net/images/cover/1596890022.jpg',
    }),
    'deezer',
  );
  assert.equal(detectTrackSource({ id: '123', source: 'deezer' }), 'deezer');

  // Fallback
  assert.equal(detectTrackSource(null), 'soundcloud');
});

test('Formatters: formatTime and formatTotalDuration calculations', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(185), '3:05');
  assert.equal(formatTime(215), '3:35');
  assert.equal(formatTime(3600), '1:00:00');
  assert.equal(formatTime(3665), '1:01:05');
  assert.equal(formatTime(7325), '2:02:05');

  assert.equal(formatTotalDuration(125), '2 мин 5 сек');
  assert.equal(formatTotalDuration(3600), '1 ч 0 мин');
  assert.equal(formatTotalDuration(5112), '1 ч 25 мин');
  assert.equal(formatTotalDuration(0), '');
  assert.equal(formatTotalDuration(-5), '');
});

test('Formatters: getCoverUrl handles valid URLs and fallbacks', () => {
  const validUrl = 'https://i1.sndcdn.com/artworks-123-t500x500.jpg';
  assert.equal(getCoverUrl(validUrl), validUrl);
  assert.equal(getCoverUrl(''), DEFAULT_COVER_SVG_DATA_URI);
  assert.equal(getCoverUrl(undefined), DEFAULT_COVER_SVG_DATA_URI);
});
