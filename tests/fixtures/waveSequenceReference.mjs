// src/shared/utils/waveHistoryLimits.ts
var WAVE_HISTORY_LIMIT = 300;
var WAVE_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1e3;

// src/shared/utils/trackFingerprint.ts
var NOISE_KEYWORDS = [
  'feat',
  'ft',
  'featuring',
  'prod',
  'produced',
  'official',
  'video',
  'audio',
  'lyric',
  'lyrics',
  'text',
  'hd',
  'hq',
  '4k',
  'remaster',
  'remastered',
  'version',
  'edit',
  'edition',
  'deluxe',
  'radio',
  'single',
  'visualizer',
  'performance',
  'mv',
  'pv',
  '\u043F\u0440\u0435\u043C\u044C\u0435\u0440\u0430',
  '\u043F\u0435\u0440\u0435\u0432\u043E\u0434',
  '\u043E\u0437\u0432\u0443\u0447\u043A\u0430',
];
var VARIANT_KEYWORDS = [
  'remix',
  'bootleg',
  'flip',
  'slowed',
  'sped',
  'speed',
  'speedup',
  'nightcore',
  'daycore',
  'reverb',
  'live',
  'acoustic',
  'cover',
  '\u043A\u0430\u0432\u0435\u0440',
  'instrumental',
  'mashup',
  'parody',
  'tribute',
  'extended',
];
var cleanSegment = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
function isNoiseSegment(s) {
  const c = cleanSegment(s);
  if (!c) return true;
  return NOISE_KEYWORDS.some((k) => new RegExp(`(^|\\s)${k}(\\s|$)`).test(c));
}
function extractCoreTitle(rawTitle) {
  let t = rawTitle || '';
  let prev;
  do {
    prev = t;
    t = t.replace(/[(\[{]([^)\]}]*)[)\]}]/g, (m, inner) => (isNoiseSegment(inner) ? ' ' : m));
  } while (t !== prev);
  t = t.replace(
    /\s[-–—|]\s*(official|video|audio|lyrics?|visualizer|hd|hq|4k|remaster\w*|premiere|премьера).*$/gi,
    '',
  );
  return cleanSegment(t);
}
function tokenize(core) {
  return core
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => /^\d+$/.test(w) || w.length >= 2);
}
function levenshtein(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let curr = i;
    let best = curr;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, curr + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      curr = tmp;
      best = Math.min(best, prev[j]);
    }
    if (best > max) return max + 1;
  }
  return prev[b.length];
}
function tokensMatch(a, b) {
  if (a === b) return true;
  const maxDist = a.length >= 8 ? 2 : a.length >= 4 ? 1 : 0;
  return maxDist > 0 && levenshtein(a, b, maxDist) <= maxDist;
}
function countOverlappingTokens(small, large) {
  let inter = 0;
  for (const tok of small.tokens) {
    if (large.set.has(tok)) {
      inter++;
      continue;
    }
    if (tok.length >= 4 && large.tokens.some((t) => tokensMatch(tok, t))) inter++;
  }
  return inter;
}
function buildTrackPrintFromTrack(track) {
  const title = track?.title || track?.name || '';
  const dur = Math.round(Number(track?.duration) || 0);
  const tokens = tokenize(extractCoreTitle(title));
  const variants = new Set(tokens.filter((tok) => VARIANT_KEYWORDS.includes(tok)));
  return { tokens, set: new Set(tokens), variants, dur };
}
function areTracksDuplicates(a, b) {
  if (!a.tokens.length || !b.tokens.length) return false;
  if (a.dur > 0 && b.dur > 0 && Math.abs(a.dur - b.dur) > 8) return false;
  if (a.variants.size !== b.variants.size) return false;
  for (const v of a.variants) {
    if (!b.variants.has(v)) return false;
  }
  const [small, large] = a.tokens.length <= b.tokens.length ? [a, b] : [b, a];
  const inter = countOverlappingTokens(small, large);
  if (inter === 0) return false;
  const coeff = inter / small.tokens.length;
  if (coeff >= 0.99) return true;
  if (coeff >= 0.75 && small.tokens.length >= 3) return true;
  return false;
}

// src/shared/utils/artistParser.ts
function parseMultiArtists(rawName) {
  if (!rawName || typeof rawName !== 'string') return [];
  const clean = rawName.trim();
  if (!clean) return [];
  const protectedNames = [
    'ac/dc',
    'earth, wind & fire',
    'crosby, stills, nash & young',
    'simon & garfunkel',
    'hall & oates',
    'blood, sweat & tears',
    'kool & the gang',
    'emerson, lake & palmer',
  ];
  if (protectedNames.includes(clean.toLowerCase())) {
    return [clean];
  }
  const normalized = clean
    .replace(/\s*(?:при\s+уч(?:\.|астии)?|уч\.)\s*/gi, ' \xA7 ')
    .replace(/(?:^|\s)(?:featuring|feat\.?|ft\.?|with|vs\.?)(?=\s|$)\s*/gi, ' \xA7 ')
    .replace(/\s*&\s*/g, ' \xA7 ')
    .replace(/\s*\/\s*/g, ' \xA7 ')
    .replace(/\s+x\s+/gi, ' \xA7 ')
    .replace(/\s*,\s*/g, ' \xA7 ');
  const parts = normalized
    .split('\xA7')
    .map((p) => p.replace(/^[\(\[\{\)\]\}]+|[\(\[\{\)\]\}]+$/g, '').trim())
    .filter((p) => p.length > 0);
  const unique = [];
  const seen = /* @__PURE__ */ new Set();
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(p);
    }
  }
  return unique.length > 0 ? unique : [clean];
}
function extractAllArtists(trackOrArtist, titleStr) {
  let rawArtist = '';
  let rawTitle = '';
  if (typeof trackOrArtist === 'string') {
    rawArtist = trackOrArtist;
    rawTitle = titleStr || '';
  } else if (trackOrArtist && typeof trackOrArtist === 'object') {
    rawArtist =
      typeof trackOrArtist.artist === 'object'
        ? trackOrArtist.artist?.name || ''
        : typeof trackOrArtist.artist === 'string'
          ? trackOrArtist.artist
          : trackOrArtist.name || '';
    rawTitle = trackOrArtist.title || titleStr || '';
  }
  const artists = [];
  const seen = /* @__PURE__ */ new Set();
  const addArtist = (name) => {
    const trimmed = name.replace(/^[\(\[\{\)\]\}]+|[\(\[\{\)\]\}]+$/g, '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      artists.push(trimmed);
    }
  };
  if (rawArtist) {
    const parsedMain = parseMultiArtists(rawArtist);
    parsedMain.forEach(addArtist);
  }
  if (rawTitle) {
    const featMatches = [
      ...rawTitle.matchAll(
        /\((?:feat\.?|ft\.?|featuring|with|vs\.?|при\s+уч(?:\.|астии)?|уч\.)\s+([^)]+)\)/gi,
      ),
      ...rawTitle.matchAll(
        /\[(?:feat\.?|ft\.?|featuring|with|vs\.?|при\s+уч(?:\.|астии)?|уч\.)\s+([^\]]+)\]/gi,
      ),
      ...rawTitle.matchAll(
        /(?:^|\s+)(?:feat\.?|ft\.?|featuring|with|vs\.?|при\s+уч(?:\.|астии)?|уч\.)\s+([^(\[\-\/]+)(?:$|\s+[\(\[-])/gi,
      ),
      ...rawTitle.matchAll(/(?:^|[\s(\[])w\/\s*([^)\](\[\-\/]+)/gi),
    ];
    for (const match of featMatches) {
      if (match[1]) {
        const featArtists = parseMultiArtists(match[1]);
        featArtists.forEach(addArtist);
      }
    }
  }
  return artists.length > 0 ? artists : [rawArtist || 'Unknown Artist'];
}

// src/shared/utils/waveIdentity.ts
var normalizeWaveArtist = (name) =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
function getWaveArtistNames(trackOrName) {
  const input = typeof trackOrName === 'string' ? { artist: trackOrName } : trackOrName;
  const raw = typeof input.artist === 'string' ? input.artist : input.artist?.name || '';
  const protectedRaw = raw.replace(/(\S)\/(?=\S)/g, '$1\u2215');
  const parsed = extractAllArtists({ ...input, artist: protectedRaw });
  const names = parsed.flatMap((name) =>
    name.toLowerCase() === '\u043A\u043E\u0440\u043E\u043B\u044C \u0438 \u0448\u0443\u0442'
      ? [name]
      : name.split(/\s+и\s+/i),
  );
  const seen = /* @__PURE__ */ new Set();
  return names
    .map((name) => name.replace(/∕/g, '/').trim())
    .filter((name) => {
      const key = normalizeWaveArtist(name);
      if (!key || key === 'unknown artist' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
var knownArtistIndexes = /* @__PURE__ */ new WeakMap();
var emptyArtistIndex = {
  names: [],
  keys: [],
  lookup: /* @__PURE__ */ new Set(),
  maxWords: 0,
};
function knownWaveArtists(names) {
  if (!names.length) return emptyArtistIndex;
  const cached = knownArtistIndexes.get(names);
  if (
    cached &&
    cached.names.length === names.length &&
    names.every((name, index2) => name === cached.names[index2])
  )
    return cached;
  const keys = [...new Set(names.map(normalizeWaveArtist).filter(Boolean))];
  const index = {
    names: [...names],
    keys,
    lookup: new Set(keys),
    maxWords: Math.max(0, ...keys.map((key) => key.split(' ').length)),
  };
  knownArtistIndexes.set(names, index);
  return index;
}
function getWaveArtistKeys(track, knownArtists = []) {
  const fields = waveSongFields(track, knownArtists);
  const rawArtist = typeof fields.artist === 'string' ? fields.artist : fields.artist?.name || '';
  const title = fields.title || '';
  const coreTitle = normalizeWaveArtist(cleanWaveSongTitle(title));
  const cleanTitle = title
    .replace(/[(\[][^([)\]]*\bprod\.?[^)\]]*[)\]]/gi, '')
    .replace(/\bprod\.?\s.*$/i, '');
  const normalizedTitle = normalizeWaveArtist(cleanTitle);
  const artistWords = normalizeWaveArtist(rawArtist).split(' ');
  const credits = cleanTitle
    .split(/\s+[-–—+]\s+|(?:^|\s)(?:(?:feat\.?|ft\.?|featuring|with)\s+|w\/\s*)/i)
    .map(normalizeWaveArtist);
  const allowsTitleCredits = !/\bcover\b|кавер/i.test(title);
  const keys = getWaveArtistNames(fields).map(normalizeWaveArtist);
  const catalog = knownWaveArtists(knownArtists);
  const addCredit = (key) => {
    if (key !== coreTitle && catalog.lookup.has(key) && /\p{L}/u.test(key)) keys.push(key);
  };
  const addCreditEdges = (text, exact, suffix) => {
    const words = text.split(' ');
    const width = Math.min(catalog.maxWords, words.length - (exact ? 0 : 1));
    for (let size = 1; size <= width; size++) {
      addCredit(words.slice(0, size).join(' '));
      if (suffix) addCredit(words.slice(-size).join(' '));
    }
  };
  if (allowsTitleCredits) {
    addCreditEdges(normalizedTitle, false, false);
    if (credits.length > 1) for (const credit of credits) addCreditEdges(credit, true, true);
  }
  for (let start = 0; start < artistWords.length; start++) {
    for (let size = 1; size <= catalog.maxWords && start + size <= artistWords.length; size++) {
      const key = artistWords.slice(start, start + size).join(' ');
      if (key.length >= 3 && catalog.lookup.has(key)) keys.push(key);
    }
  }
  return [...new Set(keys)];
}
function matchesWaveArtist(track, artist) {
  const keys = getWaveArtistKeys(track, [artist]);
  return getWaveArtistNames(artist).some((name) => keys.includes(normalizeWaveArtist(name)));
}
function isWaveNonMusic(track) {
  return /\b(?:amv|parody|snippet|teaser|trailer|karaoke|reaction|tutorial|type[\s-]*beat|podcast)\b|пароди|сниппет|тизер|караоке|минусовка|реакция|подкаст/i.test(
    track.title || '',
  );
}
function cleanWaveSongTitle(raw) {
  return extractCoreTitle(
    raw
      .normalize('NFKC')
      .replace(/([\p{L}\p{N}])['’]s\b/gu, '$1')
      .replace(/[(\[{][\s\S]*?[)\]}]/g, (part) =>
        /remix|bootleg|slowed|sped|speed|nightcore|daycore|reverb|bass\s*boost|alt\s+ver|acoustic|live|cover|кавер|акустик|замедлен|без\s/i.test(
          part,
        )
          ? ' '
          : part,
      )
      .replace(/\s+[-–—|]\s*(?:live|acoustic|cover|кавер|акустик)(?:\s.*)?$/i, '')
      .replace(
        /\b(?:remix|bootleg|slowed|sped[\s-]*up|speed[\s-]*up|speedup|nightcore|daycore|reverb|bass[\s-]*boost(?:ed)?|alt\s+ver(?:sion)?)\b.*$/i,
        '',
      ),
  );
}
function distinctiveSongTitle(tokens) {
  return (
    new Set(tokens).size >= 3 &&
    tokens.join('').length >= 16 &&
    tokens.filter((token) => token.length >= 4).length >= 2
  );
}
function waveSongFields(track, knownArtists) {
  const artist = typeof track.artist === 'string' ? track.artist : track.artist?.name || '';
  const title = cleanWaveSongTitle(track.title || '');
  if (
    title &&
    knownWaveArtists(knownArtists).lookup.has(title) &&
    title !== normalizeWaveArtist(artist) &&
    /\b(?:slowed|sped[\s-]*up|speed[\s-]*up|speedup|nightcore|daycore|remix|bootleg|acoustic|cover|live)\b|кавер|акустик|замедлен/i.test(
      track.title || '',
    ) &&
    distinctiveSongTitle(buildTrackPrintFromTrack({ title: cleanWaveSongTitle(artist) }).tokens)
  ) {
    return { title: artist, artist: title };
  }
  return track;
}
function buildWaveSongIdentity(track, knownArtists = []) {
  const fields = waveSongFields(track, knownArtists);
  const artists = getWaveArtistKeys(fields, knownArtists);
  let title = cleanWaveSongTitle(fields.title || '');
  for (const artist of [...artists].sort((a, b) => b.length - a.length)) {
    const withoutArtist = ` ${title} `.split(` ${artist} `).join(' ').trim();
    if (withoutArtist) title = withoutArtist;
  }
  const print = buildTrackPrintFromTrack({ title, duration: 0 });
  return { print, artists };
}
function areSameWaveSong(a, b) {
  if (!a.artists.some((artist) => b.artists.includes(artist))) {
    const left = a.print.tokens,
      right = b.print.tokens;
    if (left.length !== right.length || !distinctiveSongTitle(left) || !distinctiveSongTitle(right))
      return false;
    let differences = 0;
    return left.every(
      (token, index) =>
        token === right[index] || (++differences <= 1 && oneCharacterApart(token, right[index])),
    );
  }
  if (areTracksDuplicates(a.print, b.print)) return true;
  const [small, large] =
    a.print.tokens.length <= b.print.tokens.length
      ? [a.print.tokens, b.print.tokens]
      : [b.print.tokens, a.print.tokens];
  return (
    small.length >= 2 &&
    small.some((token) => large.includes(token)) &&
    small.every(
      (token) => large.includes(token) || large.some((other) => oneCharacterApart(token, other)),
    )
  );
}
function oneCharacterApart(a, b) {
  if (/\p{N}/u.test(a + b) || Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1)
    return false;
  let i = 0;
  let j = 0;
  let differences = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++differences > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return differences + Number(i < a.length || j < b.length) <= 1;
}

// src/shared/utils/waveQueue.ts
var CURATED_WAVE_FALLBACK_QUERIES = [
  'zxcursed phonk',
  'DVRST Close Eyes',
  'Kordhell Murder In My Mind',
  'Interworld METAMORPHOSIS',
  'Hensonn Sahara',
  'madk1d',
  'shadowraze',
  'OG Buda',
  'Big Baby Tape',
  'Saluki',
  'Kai Angel',
  '9mice',
  'Friendly Thug 52 NGG',
  'Toxi$',
  'ssshhhiiittt!',
  '\u0411\u0443\u0435\u0440\u0430\u043A',
  '\u041C\u043E\u043B\u0447\u0430\u0442 \u0414\u043E\u043C\u0430',
  '\u041F\u0435\u0440\u0435\u043C\u043E\u0442\u043A\u0430',
  '\u0414\u0430\u0439\u0442\u0435 \u0442\u0430\u043D\u043A (!)',
  '\u041F\u043E\u0448\u043B\u0430\u044F \u041C\u043E\u043B\u043B\u0438',
  '\u041A\u0418\u041D\u041E \u0412\u0438\u043A\u0442\u043E\u0440 \u0426\u043E\u0439',
  '\u0412\u0430\u043B\u0435\u043D\u0442\u0438\u043D \u0421\u0442\u0440\u044B\u043A\u0430\u043B\u043E',
  '\u0413\u0440\u0430\u0436\u0434\u0430\u043D\u0441\u043A\u0430\u044F \u041E\u0431\u043E\u0440\u043E\u043D\u0430',
  'ThxSoMch',
  'Nirvana',
  '\xD8neheart snowfall',
  'reidenshi lost memory',
  'leadwave memories',
  'antent your eyes',
  'Cigarettes After Sex',
  'The Weeknd',
  'Joji',
  'Chase Atlantic',
  'Arctic Monkeys',
  'Deftones',
];
function getCuratedWaveArtist(query) {
  const artists = {
    'zxcursed phonk': 'zxcursed',
    'DVRST Close Eyes': 'DVRST',
    'Kordhell Murder In My Mind': 'Kordhell',
    'Interworld METAMORPHOSIS': 'Interworld',
    'Hensonn Sahara': 'Hensonn',
    '\u041A\u0418\u041D\u041E \u0412\u0438\u043A\u0442\u043E\u0440 \u0426\u043E\u0439':
      '\u041A\u0418\u041D\u041E',
    '\xD8neheart snowfall': '\xD8neheart',
    'reidenshi lost memory': 'reidenshi',
    'leadwave memories': 'leadwave',
    'antent your eyes': 'antent',
  };
  return artists[query] || query;
}
function isWaveMixOrPodcast(track) {
  const title = (track.title || '').toLowerCase();
  return (
    [
      '1 hour',
      '2 hour',
      '3 hour',
      '10 hour',
      '1hour',
      '2hour',
      'megamix',
      'compilation',
      'full album',
      'dj set',
      'live set',
      'podcast',
      'loop 1h',
      'loop 1 hour',
      'non stop mix',
      'continuous mix',
    ].some((term) => title.includes(term)) ||
    /(?:^|[^\p{L}\p{N}])(?:микс|мегамикс|сборник|подборка|dj\s*mix|nonstop)(?:$|[^\p{L}\p{N}])/u.test(
      title,
    ) ||
    (Number(track.duration) || 0) > 1200
  );
}
function isWaveGarbageRemix(track) {
  const title = (track.title || '').toLowerCase();
  return (
    ['earrape', 'distorted', 'bass boosted 1000%', 'nightcore sped up 2x', 'troll'].some((term) =>
      title.includes(term),
    ) && !title.includes('remix')
  );
}
var artistKey = (track) =>
  (typeof track.artist === 'string' ? track.artist : track.artist?.name || '')
    .trim()
    .toLocaleLowerCase();
var TEMPO_EDIT_TITLE =
  /\b(?:slowed|sped[\s-]*up|speed[\s-]*up|speedup|nightcore|daycore|bass[\s-]*boost(?:ed)?)\b/i;
function isWaveTempoEdit(track) {
  return TEMPO_EDIT_TITLE.test(track.title || '');
}
function isWaveMoodMismatch(track, mood) {
  return (
    mood === 'energy' && /\b(?:slowed|daycore|acoustic)\b|акустик|замедлен/i.test(track.title || '')
  );
}
function waveVersionPenalty(track) {
  if (isWaveTempoEdit(track)) return 18;
  if (/\b(?:live|acoustic|cover)\b|кавер|акустик/i.test(track.title || '')) return 8;
  if (/\b(?:remix|bootleg|mashup)\b/i.test(track.title || '')) return 3;
  return /\bremaster(?:ed)?\b/i.test(track.title || '') ? 1 : 0;
}
function matchesDislikedWaveTrack(track, disliked) {
  if (String(track.id) === String(disliked.id)) return true;
  if (!disliked.title || !disliked.artist) return false;
  const artist = disliked.artist.trim().toLocaleLowerCase();
  if (
    !artist ||
    (artistKey(track) !== artist && !(track.title || '').toLocaleLowerCase().includes(artist))
  )
    return false;
  return areTracksDuplicates(buildTrackPrintFromTrack(track), buildTrackPrintFromTrack(disliked));
}
function moveDifferentArtistAfterSkip(queue, currentIndex) {
  const current = queue[currentIndex];
  const next = queue[currentIndex + 1];
  if (!current || !next) return queue;
  const knownArtists = queue.flatMap(getWaveArtistNames);
  const currentArtists = getWaveArtistKeys(current, knownArtists);
  const overlaps = (track) =>
    getWaveArtistKeys(track, knownArtists).some((artist) => currentArtists.includes(artist));
  if (!overlaps(next)) return queue;
  const replacementIndex = queue.findIndex(
    (track, index) => index > currentIndex + 1 && !overlaps(track),
  );
  if (replacementIndex < 0) return queue;
  const reordered = [...queue];
  [reordered[currentIndex + 1], reordered[replacementIndex]] = [
    reordered[replacementIndex],
    reordered[currentIndex + 1],
  ];
  return reordered;
}
function spreadWaveSeedArtists(artists, recent, weights = /* @__PURE__ */ new Map()) {
  const counts = /* @__PURE__ */ new Map();
  for (const keys of recent.slice(-50)) {
    for (const key of keys)
      counts.set(normalizeWaveArtist(key), (counts.get(normalizeWaveArtist(key)) || 0) + 1);
  }
  const cost = (artist) =>
    (counts.get(normalizeWaveArtist(artist)) || 0) +
    (weights.get(normalizeWaveArtist(artist)) === 0.25 ? 2 : 0);
  return [...artists].sort((a, b) => cost(a) - cost(b));
}
function sequenceWaveTracks(tracks, mood, familiarArtists, limit = 25, options = {}) {
  const familiar = new Set(familiarArtists.flatMap(getWaveArtistNames).map(normalizeWaveArtist));
  const knownArtists = [
    .../* @__PURE__ */ new Set([
      ...familiarArtists,
      ...tracks.flatMap(getWaveArtistNames),
      ...(options.recentTracks || []).flatMap(getWaveArtistNames),
    ]),
  ];
  const recentSongs = (options.recentTracks || []).map((track) =>
    buildWaveSongIdentity(track, knownArtists),
  );
  const offeredSongs = (options.offeredTracks || []).map((track) =>
    buildWaveSongIdentity(track, knownArtists),
  );
  const offeredArtists = (options.offeredTracks || [])
    .slice(-25)
    .map((track) => getWaveArtistKeys(track, knownArtists));
  const candidates = tracks
    .filter(
      (track) =>
        !track.playbackUnavailable && !isWaveNonMusic(track) && !isWaveMoodMismatch(track, mood),
    )
    .map((track) => {
      const artists = getWaveArtistKeys(track, knownArtists);
      const song = buildWaveSongIdentity(track, knownArtists);
      const exposurePenalty =
        (offeredSongs.some((offered) => areSameWaveSong(offered, song)) ? 8 : 0) +
        Math.min(
          4,
          offeredArtists.filter((keys) => keys.some((key) => artists.includes(key))).length,
        );
      const versionPenalty = waveVersionPenalty(track);
      const versionPriority =
        versionPenalty + (artists.some((artist) => familiar.has(artist)) ? 0 : 0.5);
      return {
        track,
        artists,
        song,
        exposurePenalty,
        versionPenalty,
        versionPriority,
      };
    })
    .filter(({ song }) => !recentSongs.some((recent2) => areSameWaveSong(recent2, song)));
  const remaining = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other.versionPriority < candidate.versionPriority &&
          areSameWaveSong(candidate.song, other.song),
      ),
  );
  const result = [];
  const artistCounts = /* @__PURE__ */ new Map();
  const recent = (options.recentArtists || [])
    .slice(-40)
    .map((name) => getWaveArtistKeys({ artist: name }));
  if (options.recentTracks?.length) {
    recent.push(
      ...options.recentTracks.slice(-40).map((track) => getWaveArtistKeys(track, knownArtists)),
    );
  }
  for (const keys of recent.slice(-40))
    for (const artist of keys) artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
  const familiarityPattern =
    mood === 'discover'
      ? [false, false, false, true]
      : mood === 'favorites'
        ? [true, true, true, false]
        : mood === 'mix'
          ? [true, false]
          : [true, true, false];
  while (remaining.length > 0 && result.length < limit) {
    const recentArtists = recent.slice(-8);
    const previousSource = result[result.length - 1]?.source;
    const wantsFamiliar = familiarityPattern[result.length % familiarityPattern.length];
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < remaining.length; index++) {
      const { track, artists, exposurePenalty, versionPenalty } = remaining[index];
      const known = artists.some((artist) => familiar.has(artist));
      // The mode's familiarity target must survive ordinary taste and exposure bonuses.
      const discoveryBonus = mood === 'discover' ? 12 : mood === 'mix' ? 8 : 4;
      let score = known === wantsFamiliar ? discoveryBonus : 0;
      score += known ? 0.5 : 0;
      score -= exposurePenalty;
      const feedback = artists.map((artist) => options.artistFeedback?.get(artist) || 0);
      score += Math.max(-3, Math.min(3, Math.min(0, ...feedback) || Math.max(0, ...feedback))) * 4;
      const lastArtistIndex = recentArtists
        .map((keys) => keys.some((artist) => artists.includes(artist)))
        .lastIndexOf(true);
      if (lastArtistIndex >= 0) {
        const tracksSinceArtist = recentArtists.length - 1 - lastArtistIndex;
        score -= [48, 40, 32, 24, 18, 12, 8, 4][tracksSinceArtist] || 0;
      }
      const windowCount = recent
        .slice(-12)
        .filter((keys) => keys.some((artist) => artists.includes(artist))).length;
      if (windowCount >= 2) score -= (windowCount - 1) * 24;
      score -= Math.max(0, ...artists.map((artist) => artistCounts.get(artist) || 0)) * 6;
      if (previousSource && track.source && track.source !== previousSource) score += 0.5;
      if (track.album?.title && track.album.title !== 'Single') score += 0.4;
      if (track.duration >= 150 && track.duration <= 360) score += 0.3;
      score -= versionPenalty;
      if (
        /\b(karaoke|type beat|fan.?made|reaction|podcast)\b|караоке|минусовка/i.test(
          track.title || '',
        )
      )
        score -= 5;
      score -= index * 1e-3;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    result.push(chosen.track);
    recent.push(chosen.artists);
    for (const artist of chosen.artists)
      artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    for (let index = remaining.length - 1; index >= 0; index--) {
      if (areSameWaveSong(chosen.song, remaining[index].song)) remaining.splice(index, 1);
    }
  }
  return result;
}
function resequenceWaveQueue(
  queue,
  currentIndex,
  mood,
  familiarArtists,
  artistFeedback,
  history = [],
  offeredTracks = [],
) {
  const played = queue.slice(0, currentIndex + 1);
  const pending = queue.slice(currentIndex + 1);
  const playedIds = new Set(played.map((track) => String(track.id)));
  const sequenced = sequenceWaveTracks(pending, mood, familiarArtists, pending.length, {
    artistFeedback,
    offeredTracks,
    recentTracks: [...history.filter((track) => !playedIds.has(String(track.id))), ...played].slice(
      -WAVE_HISTORY_LIMIT,
    ),
  });
  return [...played, ...sequenced];
}
export {
  CURATED_WAVE_FALLBACK_QUERIES,
  areSameWaveSong,
  areTracksDuplicates,
  buildTrackPrintFromTrack,
  buildWaveSongIdentity,
  extractCoreTitle,
  getCuratedWaveArtist,
  getWaveArtistKeys,
  getWaveArtistNames,
  isWaveGarbageRemix,
  isWaveMixOrPodcast,
  isWaveMoodMismatch,
  isWaveNonMusic,
  isWaveTempoEdit,
  matchesDislikedWaveTrack,
  matchesWaveArtist,
  moveDifferentArtistAfterSkip,
  normalizeWaveArtist,
  resequenceWaveQueue,
  sequenceWaveTracks,
  spreadWaveSeedArtists,
};
