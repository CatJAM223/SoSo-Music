// src/shared/utils/waveMusicProfile.ts
function waveMusicMetadata(value) {
  const genre = typeof value.genre === "string" ? value.genre.trim().slice(0, 100) : "";
  const tags = Array.isArray(value.tags) ? [
    ...new Set(
      value.tags.slice(0, 16).filter((tag) => typeof tag === "string").map((tag) => tag.trim().slice(0, 80)).filter(Boolean)
    )
  ] : [];
  return { ...genre ? { genre } : {}, ...tags.length ? { tags } : {} };
}
var STYLE_ALIASES = [
  ["rock", /(?:^| )(?:rock|рок)(?: |$)/u],
  ["nu metal", /(?:^| )(?:nu metal|numetal|ню метал|нью метал)(?: |$)/u],
  ["grunge", /(?:^| )(?:grunge|гранж)(?: |$)/u],
  ["metalcore", /(?:^| )(?:metalcore|металкор)(?: |$)/u],
  ["alternative rock", /(?:^| )(?:alternative rock|альтернативный рок)(?: |$)/u],
  ["indie rock", /(?:^| )(?:indie rock|инди рок)(?: |$)/u],
  ["shoegaze", /(?:^| )(?:shoegaze|шугейз)(?: |$)/u],
  ["emo", /(?:^| )(?:emo|эмо)(?: |$)/u],
  ["metal", /(?:^| )(?:metal|метал|металл)(?: |$)/u],
  ["punk", /(?:^| )(?:punk|панк)(?: |$)/u],
  ["post punk", /(?:^| )(?:post punk|postpunk|постпанк|пост панк)(?: |$)/u],
  ["hip hop", /(?:^| )(?:hip hop|hiphop|rap|trap|рэп|хип хоп|трэп)(?: |$)/u],
  ["phonk", /(?:^| )(?:phonk|фонк)(?: |$)/u],
  ["electronic", /(?:^| )(?:electronic|electronica|edm|электроника)(?: |$)/u],
  ["house", /(?:^| )(?:house|хаус)(?: |$)/u],
  ["techno", /(?:^| )(?:techno|техно)(?: |$)/u],
  ["drum and bass", /(?:^| )(?:drum and bass|drum bass|dnb|d n b|драм н бейс)(?: |$)/u],
  ["dubstep", /(?:^| )(?:dubstep|дабстеп)(?: |$)/u],
  ["ambient", /(?:^| )(?:ambient|эмбиент|эмбиэнт)(?: |$)/u],
  ["lo fi", /(?:^| )(?:lo fi|lofi|лоуфай)(?: |$)/u],
  ["jazz", /(?:^| )(?:jazz|джаз)(?: |$)/u],
  ["classical", /(?:^| )(?:classical|классика|классическая)(?: |$)/u],
  ["folk", /(?:^| )(?:folk|фолк)(?: |$)/u],
  ["acoustic", /(?:^| )(?:acoustic|акустика|акустический)(?: |$)/u],
  ["pop", /(?:^| )(?:pop|поп)(?: |$)/u],
  ["rnb", /(?:^| )(?:rnb|r b|r and b)(?: |$)/u],
  ["soul", /(?:^| )(?:soul|соул)(?: |$)/u],
  ["reggae", /(?:^| )(?:reggae|регги)(?: |$)/u],
  ["country", /(?:^| )(?:country|кантри)(?: |$)/u]
];
var CALM = /(?:^| )(?:chill|chillout|calm|relax|relaxed|relaxing|sleep|sleepy|meditation|спокойная|спокойное|расслабляющая)(?: |$)/u;
var CALM_STYLE = /(?:^| )(?:ambient|lo fi|lofi|downtempo|эмбиент|эмбиэнт)(?: |$)/u;
var ACTIVE = /(?:^| )(?:energetic|energy|upbeat|aggressive|workout|dance|бодрая|бодрое|энергичная|энергичное|танцевальная)(?: |$)/u;
var ACTIVE_STYLE = /(?:^| )(?:hardstyle|hardcore|metal|punk|phonk|dnb|drum and bass|drum bass|фонк|метал|панк)(?: |$)/u;
function waveMusicProfile(track) {
  const metadata = waveMusicMetadata(track);
  const labels = [metadata.genre || "", ...metadata.tags || []].map(
    (label) => label.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  ).filter(Boolean);
  const styles = /* @__PURE__ */ new Set();
  for (const [style, pattern] of STYLE_ALIASES)
    if (labels.some((label) => pattern.test(label))) styles.add(style);
  const calm = labels.some((label) => CALM.test(label));
  const active2 = labels.some((label) => ACTIVE.test(label));
  const energy = calm || active2 ? Number(active2) - Number(calm) : Number(labels.some((label) => ACTIVE_STYLE.test(label))) - Number(labels.some((label) => CALM_STYLE.test(label)));
  return { styles, energy };
}
function similarity(left, right) {
  if (!left.styles.size || !right.styles.size) return 0;
  let shared = 0;
  for (const style of left.styles) if (right.styles.has(style)) shared++;
  const moodCompatibility = left.energy * right.energy < 0 ? 0.2 : 1;
  return shared / Math.sqrt(left.styles.size * right.styles.size) * moodCompatibility;
}
function waveMoodScore(profile, mood) {
  return mood === "energy" ? profile.energy * 12 : mood === "chill" ? -profile.energy * 12 : 0;
}
function createWaveMusicScorer(taste = [], positives = [], skipped = [], learned = []) {
  const profiles = (tracks, limit) => {
    const seen = /* @__PURE__ */ new Set();
    const selected = [];
    for (const track of tracks) {
      if (seen.has(String(track.id))) continue;
      seen.add(String(track.id));
      selected.push(waveMusicProfile(track));
      if (selected.length >= limit) break;
    }
    return selected;
  };
  const tasteProfiles = profiles(taste, 48), positiveProfiles = profiles(positives, 12), skippedProfiles = profiles(skipped, 12), learnedProfiles = profiles(learned, 48);
  const affinity = (profile, pool, decay = 1) => Math.max(0, ...pool.map((anchor, index) => similarity(profile, anchor) * decay ** index));
  return (profile, mood) => {
    const negativeEvidence = skippedProfiles.reduce(
      (sum, anchor, index) => sum + similarity(profile, anchor) * 0.75 ** index,
      0
    );
    const positive = affinity(profile, positiveProfiles, 0.85) * Math.max(0, 1 - Math.max(0, negativeEvidence - 1.5) / 0.75);
    const negative = Math.min(1, negativeEvidence / 2);
    let score = waveMoodScore(profile, mood) + affinity(profile, tasteProfiles) * 2 + affinity(profile, learnedProfiles) * 1.5 + positive * 4;
    score -= Math.max(0, negative - positive) * 4;
    return score;
  };
}
function waveTransitionScore(profile, previous, mood) {
  if (!previous) return 0;
  if (mood === "mix") return -similarity(profile, previous) * 3;
  const coherence = similarity(profile, previous) * 1.5 - (profile.energy * previous.energy < 0 ? 1 : 0);
  return coherence;
}

// src/shared/utils/libraryTaste.ts
var LIBRARY_GENRE_MIN_SCORE = -2;
var LIBRARY_GENRE_MAX_SCORE = 6;
function libraryGenreAffinity(styles, genres) {
  const knownGenres = genres.filter((genre) => Number.isFinite(genre.share) && genre.share > 0);
  if (!styles.size || !knownGenres.length) return 0;
  const dominantShare = Math.max(...knownGenres.map((genre) => genre.share));
  const matchedShare = Math.max(
    0,
    ...knownGenres.filter((genre) => styles.has(genre.name)).map((genre) => genre.share)
  );
  return matchedShare ? matchedShare / dominantShare * LIBRARY_GENRE_MAX_SCORE : LIBRARY_GENRE_MIN_SCORE;
}
function boundedLibraryGenreScore(score) {
  return Number.isFinite(score) ? Math.max(LIBRARY_GENRE_MIN_SCORE, Math.min(LIBRARY_GENRE_MAX_SCORE, score)) : 0;
}

// src/shared/utils/waveCandidateRanking.ts
var ARTIST_DISTANCE_PENALTIES = [48, 40, 32, 24, 18, 12, 8, 4];
var RECENT_ARTIST_WINDOW = 12;
var REPEATED_ARTIST_PENALTY = 24;
var TOTAL_ARTIST_PENALTY = 6;
var MATCHED_DISCOVERY_BONUS = 4;
var FAMILIAR_ARTIST_BONUS = 0.5;
var RADIO_BONUS = 1.5;
var FEEDBACK_LIMIT = 3;
var FEEDBACK_WEIGHT = 4;
var SOURCE_VARIETY_BONUS = 0.5;
var ALBUM_BONUS = 0.4;
var REGULAR_DURATION_BONUS = 0.3;
var NON_SONG_PENALTY = 5;
var PROVIDER_ORDER_WEIGHT = 1e-3;
function artistSpacingPenalties(artists, context) {
  const recentArtists = context.recent.slice(-ARTIST_DISTANCE_PENALTIES.length);
  const overlaps = (keys) => keys.some((artist) => artists.includes(artist));
  const lastIndex = recentArtists.map(overlaps).lastIndexOf(true);
  const distance = lastIndex >= 0 ? ARTIST_DISTANCE_PENALTIES[recentArtists.length - 1 - lastIndex] || 0 : 0;
  const count = context.recent.slice(-RECENT_ARTIST_WINDOW).filter(overlaps).length;
  return { distance, density: count >= 2 ? (count - 1) * REPEATED_ARTIST_PENALTY : 0 };
}
function feedbackScore(artists, feedback) {
  const values = artists.map((artist) => feedback?.get(artist) || 0);
  return Math.max(
    -FEEDBACK_LIMIT,
    Math.min(FEEDBACK_LIMIT, Math.min(0, ...values) || Math.max(0, ...values))
  ) * FEEDBACK_WEIGHT;
}
function scoreWaveCandidate(candidate, index, context) {
  const { track, artists, music, musicScore, likeScore, exposurePenalty, versionPenalty } = candidate;
  const known = artists.some((artist) => context.familiar.has(artist));
  const discoveryBonus = context.mood === "discover" ? 12 : context.mood === "mix" ? 8 : MATCHED_DISCOVERY_BONUS;
  let score = known === context.wantsFamiliar ? discoveryBonus : 0;
  score += known ? FAMILIAR_ARTIST_BONUS : 0;
  score -= exposurePenalty;
  score += likeScore + musicScore + waveTransitionScore(music, context.previousMusic, context.mood);
  if (Number.isFinite(track.waveRadioScore))
    score += Math.max(0, Math.min(1, track.waveRadioScore)) * RADIO_BONUS;
  score += feedbackScore(artists, context.artistFeedback);
  const spacing = artistSpacingPenalties(artists, context);
  score -= spacing.distance;
  score -= spacing.density;
  score -= Math.max(0, ...artists.map((artist) => context.artistCounts.get(artist) || 0)) * TOTAL_ARTIST_PENALTY;
  if (context.previousSource && track.source && track.source !== context.previousSource)
    score += SOURCE_VARIETY_BONUS;
  if (track.album?.title && track.album.title !== "Single") score += ALBUM_BONUS;
  if (track.duration >= 150 && track.duration <= 360) score += REGULAR_DURATION_BONUS;
  score -= versionPenalty;
  if (/\b(karaoke|type beat|fan.?made|reaction|podcast)\b|караоке|минусовка/i.test(track.title || ""))
    score -= NON_SONG_PENALTY;
  return score - index * PROVIDER_ORDER_WEIGHT;
}

// src/shared/compute/waveTextCache.ts
var MAX_ENTRIES = 2048;
var MAX_TEXT_LENGTH = 1024;
var active = null;
function withWaveTextCache(work) {
  if (active) return work();
  active = { artist: /* @__PURE__ */ new Map(), title: /* @__PURE__ */ new Map() };
  try {
    return work();
  } finally {
    active = null;
  }
}
function cachedWaveText(kind, input, compute) {
  const map = active?.[kind];
  if (!map || input.length > MAX_TEXT_LENGTH) return compute(input);
  const cached = map.get(input);
  if (cached !== void 0) return cached;
  const value = compute(input);
  if (map.size < MAX_ENTRIES && value.length <= MAX_TEXT_LENGTH) map.set(input, value);
  return value;
}

// src/shared/utils/artistParser.ts
function parseMultiArtists(rawName) {
  if (!rawName || typeof rawName !== "string") return [];
  const clean = rawName.trim();
  if (!clean) return [];
  const protectedNames = [
    "ac/dc",
    "earth, wind & fire",
    "crosby, stills, nash & young",
    "simon & garfunkel",
    "hall & oates",
    "blood, sweat & tears",
    "kool & the gang",
    "emerson, lake & palmer"
  ];
  if (protectedNames.includes(clean.toLowerCase())) {
    return [clean];
  }
  const normalized = clean.replace(/\s*(?:при\s+уч(?:\.|астии)?|уч\.)\s*/gi, " \xA7 ").replace(/(?:^|\s)(?:featuring|feat\.?|ft\.?|with|vs\.?)(?=\s|$)\s*/gi, " \xA7 ").replace(/\s*&\s*/g, " \xA7 ").replace(/\s*\/\s*/g, " \xA7 ").replace(/\s+x\s+/gi, " \xA7 ").replace(/\s*,\s*/g, " \xA7 ");
  const parts = normalized.split("\xA7").map((p) => p.replace(/^[\(\[\{\)\]\}]+|[\(\[\{\)\]\}]+$/g, "").trim()).filter((p) => p.length > 0);
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
  let rawArtist = "";
  let rawTitle = "";
  if (typeof trackOrArtist === "string") {
    rawArtist = trackOrArtist;
    rawTitle = titleStr || "";
  } else if (trackOrArtist && typeof trackOrArtist === "object") {
    rawArtist = typeof trackOrArtist.artist === "object" ? trackOrArtist.artist?.name || "" : typeof trackOrArtist.artist === "string" ? trackOrArtist.artist : trackOrArtist.name || "";
    rawTitle = trackOrArtist.title || titleStr || "";
  }
  const artists = [];
  const seen = /* @__PURE__ */ new Set();
  const addArtist = (name) => {
    const trimmed = name.replace(/^[\(\[\{\)\]\}]+|[\(\[\{\)\]\}]+$/g, "").trim();
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
        /\((?:feat\.?|ft\.?|featuring|with|vs\.?|при\s+уч(?:\.|астии)?|уч\.)\s+([^)]+)\)/gi
      ),
      ...rawTitle.matchAll(
        /\[(?:feat\.?|ft\.?|featuring|with|vs\.?|при\s+уч(?:\.|астии)?|уч\.)\s+([^\]]+)\]/gi
      ),
      ...rawTitle.matchAll(
        /(?:^|\s+)(?:feat\.?|ft\.?|featuring|with|vs\.?|при\s+уч(?:\.|астии)?|уч\.)\s+([^(\[\-\/]+)(?:$|\s+[\(\[-])/gi
      ),
      ...rawTitle.matchAll(/(?:^|[\s(\[])w\/\s*([^)\](\[\-\/]+)/gi)
    ];
    for (const match of featMatches) {
      if (match[1]) {
        const featArtists = parseMultiArtists(match[1]);
        featArtists.forEach(addArtist);
      }
    }
  }
  return artists.length > 0 ? artists : [rawArtist || "Unknown Artist"];
}

// src/shared/utils/trackFingerprint.ts
var NOISE_KEYWORDS = [
  "feat",
  "ft",
  "featuring",
  "prod",
  "produced",
  "official",
  "video",
  "audio",
  "lyric",
  "lyrics",
  "text",
  "hd",
  "hq",
  "4k",
  "remaster",
  "remastered",
  "version",
  "edit",
  "edition",
  "deluxe",
  "radio",
  "single",
  "visualizer",
  "performance",
  "mv",
  "pv",
  "\u043F\u0440\u0435\u043C\u044C\u0435\u0440\u0430",
  "\u043F\u0435\u0440\u0435\u0432\u043E\u0434",
  "\u043E\u0437\u0432\u0443\u0447\u043A\u0430"
];
var VARIANT_KEYWORDS = [
  "remix",
  "bootleg",
  "flip",
  "slowed",
  "sped",
  "speed",
  "speedup",
  "nightcore",
  "daycore",
  "reverb",
  "live",
  "acoustic",
  "cover",
  "\u043A\u0430\u0432\u0435\u0440",
  "instrumental",
  "mashup",
  "parody",
  "tribute",
  "extended"
];
var cleanSegment = (s) => (s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
function isNoiseSegment(s) {
  const c = cleanSegment(s);
  if (!c) return true;
  return NOISE_KEYWORDS.some((k) => new RegExp(`(^|\\s)${k}(\\s|$)`).test(c));
}
function extractCoreTitle(rawTitle) {
  return cachedWaveText("title", rawTitle || "", extractUncachedCoreTitle);
}
function extractUncachedCoreTitle(rawTitle) {
  let t = rawTitle || "";
  let prev;
  do {
    prev = t;
    t = t.replace(
      /[(\[{]([^)\]}]*)[)\]}]/g,
      (m, inner) => isNoiseSegment(inner) ? " " : m
    );
  } while (t !== prev);
  t = t.replace(
    /\s[-–—|]\s*(official|video|audio|lyrics?|visualizer|hd|hq|4k|remaster\w*|premiere|премьера).*$/gi,
    ""
  );
  return cleanSegment(t);
}
function tokenize(core2) {
  return core2.split(/\s+/).map((w) => w.trim()).filter((w) => /^\d+$/.test(w) || w.length >= 2);
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
  const title = track?.title || track?.name || "";
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

// src/shared/utils/waveIdentity.ts
var normalizeWaveArtist = (name) => cachedWaveText("artist", name, normalizeArtistText);
var normalizeArtistText = (name) => name.normalize("NFKC").toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function getWaveArtistNames(trackOrName) {
  const input = typeof trackOrName === "string" ? { artist: trackOrName } : trackOrName;
  const raw = typeof input.artist === "string" ? input.artist : input.artist?.name || "";
  const protectedRaw = raw.replace(/(\S)\/(?=\S)/g, "$1\u2215");
  const parsed = extractAllArtists({ ...input, artist: protectedRaw });
  const names = parsed.flatMap(
    (name) => name.toLowerCase() === "\u043A\u043E\u0440\u043E\u043B\u044C \u0438 \u0448\u0443\u0442" ? [name] : name.split(/\s+и\s+/i)
  );
  const seen = /* @__PURE__ */ new Set();
  return names.map((name) => name.replace(/∕/g, "/").trim()).filter((name) => {
    const key = normalizeWaveArtist(name);
    if (!key || key === "unknown artist" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
var knownArtistIndexes = /* @__PURE__ */ new WeakMap();
var emptyArtistIndex = { names: [], keys: [], lookup: /* @__PURE__ */ new Set(), maxWords: 0 };
function knownWaveArtists(names) {
  if (!names.length) return emptyArtistIndex;
  const cached = knownArtistIndexes.get(names);
  if (cached && cached.names.length === names.length && names.every((name, index2) => name === cached.names[index2]))
    return cached;
  const keys = [...new Set(names.map(normalizeWaveArtist).filter(Boolean))];
  const index = {
    names: [...names],
    keys,
    lookup: new Set(keys),
    maxWords: Math.max(0, ...keys.map((key) => key.split(" ").length))
  };
  knownArtistIndexes.set(names, index);
  return index;
}
function getWaveArtistKeys(track, knownArtists = []) {
  const fields = waveSongFields(track, knownArtists);
  const rawArtist = typeof fields.artist === "string" ? fields.artist : fields.artist?.name || "";
  const title = fields.title || "";
  const coreTitle = normalizeWaveArtist(cleanWaveSongTitle(title));
  const cleanTitle = title.replace(/[(\[][^([)\]]*\bprod\.?[^)\]]*[)\]]/gi, "").replace(/\bprod\.?\s.*$/i, "");
  const normalizedTitle = normalizeWaveArtist(cleanTitle);
  const artistWords = normalizeWaveArtist(rawArtist).split(" ");
  const credits = cleanTitle.split(/\s+[-–—+]\s+|(?:^|\s)(?:(?:feat\.?|ft\.?|featuring|with)\s+|w\/\s*)/i).map(normalizeWaveArtist);
  const allowsTitleCredits = !/\bcover\b|кавер/i.test(title);
  const keys = getWaveArtistNames(fields).map(normalizeWaveArtist);
  const catalog = knownWaveArtists(knownArtists);
  const addCredit = (key) => {
    if (key !== coreTitle && catalog.lookup.has(key) && /\p{L}/u.test(key)) keys.push(key);
  };
  const addCreditEdges = (text, exact, suffix) => {
    const words = text.split(" ");
    const width = Math.min(catalog.maxWords, words.length - (exact ? 0 : 1));
    for (let size = 1; size <= width; size++) {
      addCredit(words.slice(0, size).join(" "));
      if (suffix) addCredit(words.slice(-size).join(" "));
    }
  };
  if (allowsTitleCredits) {
    addCreditEdges(normalizedTitle, false, false);
    if (credits.length > 1) for (const credit of credits) addCreditEdges(credit, true, true);
  }
  for (let start = 0; start < artistWords.length; start++) {
    for (let size = 1; size <= catalog.maxWords && start + size <= artistWords.length; size++) {
      const key = artistWords.slice(start, start + size).join(" ");
      if (key.length >= 3 && catalog.lookup.has(key)) keys.push(key);
    }
  }
  return [...new Set(keys)];
}
function isWaveNonMusic(track) {
  return /\b(?:amv|parody|snippet|teaser|trailer|karaoke|reaction|tutorial|type[\s-]*beat|podcast)\b|пароди|сниппет|тизер|караоке|минусовка|реакция|подкаст/i.test(
    track.title || ""
  );
}
function cleanWaveSongTitle(raw) {
  return extractCoreTitle(
    raw.normalize("NFKC").replace(/([\p{L}\p{N}])['’]s\b/gu, "$1").replace(
      /[(\[{][\s\S]*?[)\]}]/g,
      (part) => /remix|bootleg|slowed|sped|speed|nightcore|daycore|reverb|bass\s*boost|alt\s+ver|acoustic|live|cover|кавер|акустик|замедлен|без\s/i.test(
        part
      ) ? " " : part
    ).replace(/\s+[-–—|]\s*(?:live|acoustic|cover|кавер|акустик)(?:\s.*)?$/i, "").replace(
      /\b(?:remix|bootleg|slowed|sped[\s-]*up|speed[\s-]*up|speedup|nightcore|daycore|reverb|bass[\s-]*boost(?:ed)?|alt\s+ver(?:sion)?)\b.*$/i,
      ""
    )
  );
}
function distinctiveSongTitle(tokens) {
  return new Set(tokens).size >= 3 && tokens.join("").length >= 16 && tokens.filter((token) => token.length >= 4).length >= 2;
}
function waveSongFields(track, knownArtists) {
  const artist = typeof track.artist === "string" ? track.artist : track.artist?.name || "";
  const title = cleanWaveSongTitle(track.title || "");
  if (title && knownWaveArtists(knownArtists).lookup.has(title) && title !== normalizeWaveArtist(artist) && /\b(?:slowed|sped[\s-]*up|speed[\s-]*up|speedup|nightcore|daycore|remix|bootleg|acoustic|cover|live)\b|кавер|акустик|замедлен/i.test(
    track.title || ""
  ) && distinctiveSongTitle(buildTrackPrintFromTrack({ title: cleanWaveSongTitle(artist) }).tokens)) {
    return { title: artist, artist: title };
  }
  return track;
}
function buildWaveSongIdentity(track, knownArtists = []) {
  const fields = waveSongFields(track, knownArtists);
  const artists = getWaveArtistKeys(fields, knownArtists);
  let title = cleanWaveSongTitle(fields.title || "");
  for (const artist of [...artists].sort((a, b) => b.length - a.length)) {
    const withoutArtist = ` ${title} `.split(` ${artist} `).join(" ").trim();
    if (withoutArtist) title = withoutArtist;
  }
  const print = buildTrackPrintFromTrack({ title, duration: 0 });
  return { print, artists };
}
function areSameWaveSong(a, b) {
  if (!a.artists.some((artist) => b.artists.includes(artist))) {
    const left = a.print.tokens, right = b.print.tokens;
    if (left.length !== right.length || !distinctiveSongTitle(left) || !distinctiveSongTitle(right))
      return false;
    let differences = 0;
    return left.every(
      (token, index) => token === right[index] || ++differences <= 1 && oneCharacterApart(token, right[index])
    );
  }
  if (areTracksDuplicates(a.print, b.print)) return true;
  const [small, large] = a.print.tokens.length <= b.print.tokens.length ? [a.print.tokens, b.print.tokens] : [b.print.tokens, a.print.tokens];
  return small.length >= 2 && small.some((token) => large.includes(token)) && small.every(
    (token) => large.includes(token) || large.some((other) => oneCharacterApart(token, other))
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

// src/shared/utils/waveFeedback.ts
function waveDiscoveryTarget(mood, adjustment = 0) {
  const base = mood === "discover" ? 0.75 : mood === "mix" ? 0.5 : mood === "favorites" || mood === "default" ? 0.25 : 1 / 3;
  const bounds = mood === "discover" ? [0.6, 0.9] : mood === "favorites" ? [0.1, 0.35] : mood === "mix" ? [0.3, 0.7] : mood === "default" ? [0.1, 0.4] : [0.15, 0.55];
  const change = Number.isFinite(adjustment) ? Math.max(-0.2, Math.min(0.2, adjustment)) : 0;
  return Math.max(bounds[0], Math.min(bounds[1], base + change));
}

// src/shared/utils/logger.ts
var isDev = typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production";
var Logger = class {
  level = isDev ? "debug" : "info";
  setLevel(level) {
    this.level = level;
  }
  debug(message, ...args) {
    if (this.level === "debug") {
      console.debug(`%c[DEBUG] ${message}`, "color: #888", ...args);
    }
  }
  info(message, ...args) {
    if (this.level === "debug" || this.level === "info") {
      console.info(`%c[INFO] ${message}`, "color: #3b82f6", ...args);
    }
  }
  warn(message, ...args) {
    if (this.level !== "error") {
      console.warn(`%c[WARN] ${message}`, "color: #f59e0b", ...args);
    }
  }
  error(message, ...args) {
    console.error(`%c[ERROR] ${message}`, "color: #ef4444", ...args);
  }
};
var logger = new Logger();

// src/shared/compute/waveSongMatrix.ts
var MAX_INPUT = 2 * 1024 * 1024;
var MAX_CANDIDATES = 1e3;
var MIN_MATRIX_COMPARISONS = 5e3;
var core = null;
var initialization = null;
var warned = false;
function unavailable() {
  if (warned) return;
  warned = true;
  logger.warn("[Compute:Rust] Song matching unavailable; using JavaScript");
}
function initializeRustCompute(bytes) {
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      const result = await WebAssembly.instantiate(bytes, {});
      const exports = result.instance.exports;
      if (exports.abi_version?.() !== 2 || !(exports.memory instanceof WebAssembly.Memory) || typeof exports.reserve !== "function" || typeof exports.calculate !== "function" || typeof exports.output_ptr !== "function")
        throw Error("Unsupported compute ABI");
      core = exports;
      logger.info("[Compute:Rust] Local song matcher ready (ABI 2, memory limit 16 MiB)");
      return true;
    } catch {
      core = null;
      unavailable();
      return false;
    }
  })();
  return initialization;
}
function createWaveSongMatrix(candidates, recent, offered) {
  const count = candidates.length;
  if (!core || count > MAX_CANDIDATES || recent.length > 300 || offered.length > 80 || count * (count + recent.length + offered.length) < MIN_MATRIX_COMPARISONS)
    return null;
  let packedUnits = 0;
  let supported = true;
  const tokens = [], tokenIds = /* @__PURE__ */ new Map(), artistIds = /* @__PURE__ */ new Map(), variantIds = /* @__PURE__ */ new Map();
  const intern = (map, value) => {
    let id = map.get(value);
    if (id === void 0) {
      id = map.size;
      map.set(value, id);
    }
    return id;
  };
  const packToken = (value) => {
    let id = tokenIds.get(value);
    if (id === void 0) {
      if (!supported || tokens.length >= 8192 || packedUnits + value.length > 262144) {
        supported = false;
        return 0;
      }
      packedUnits += value.length;
      id = tokenIds.size;
      tokenIds.set(value, id);
      tokens.push({
        units: Array.from({ length: value.length }, (_, index) => value.charCodeAt(index)),
        numeric: /\p{N}/u.test(value)
      });
    }
    return id;
  };
  const pack = (song) => {
    if (!supported || song.print.tokens.length > 64 || song.artists.length > 32 || song.print.variants.size > 32 || !Number.isFinite(song.print.dur) || song.print.tokens.some((token) => token.length > 1024)) {
      supported = false;
      return { tokens: [], artists: [], variants: [], duration: 0 };
    }
    return {
      tokens: song.print.tokens.map(packToken),
      artists: song.artists.map((artist) => intern(artistIds, artist)),
      variants: [...song.print.variants].map((variant) => intern(variantIds, variant)),
      duration: song.print.dur
    };
  };
  try {
    const job = {
      candidates: candidates.map(pack),
      recent: recent.map(pack),
      offered: offered.map(pack),
      tokens
    };
    if (!supported || tokens.length > 8192 || tokens.reduce((sum, token) => sum + token.units.length, 0) > 262144)
      return null;
    if (new Uint8Array(Uint32Array.of(1).buffer)[0] !== 1) return null;
    const words = [1397707599, 2, count, recent.length, offered.length, tokens.length];
    for (const token of tokens)
      words.push(token.units.length, token.numeric ? 1 : 0, ...token.units);
    const floating = new DataView(new ArrayBuffer(8));
    for (const song of [...job.candidates, ...job.recent, ...job.offered]) {
      floating.setFloat64(0, song.duration, true);
      words.push(
        song.tokens.length,
        song.artists.length,
        song.variants.length,
        floating.getUint32(0, true),
        floating.getUint32(4, true),
        ...song.tokens,
        ...song.artists,
        ...song.variants
      );
    }
    const bytes = new Uint8Array(Uint32Array.from(words).buffer);
    if (bytes.length > MAX_INPUT) return null;
    const pointer = core.reserve(bytes.length);
    if (!pointer || pointer + bytes.length > core.memory.buffer.byteLength)
      throw Error("Invalid input buffer");
    new Uint8Array(core.memory.buffer, pointer, bytes.length).set(bytes);
    const size = core.calculate(bytes.length), output = core.output_ptr();
    if (size !== count * count + 2 * count || output + size > core.memory.buffer.byteLength)
      throw Error("Invalid result buffer");
    const flags = new Uint8Array(core.memory.buffer, output, size).slice();
    return {
      wasHeard: (index) => flags[index] === 1,
      wasOffered: (index) => flags[count + index] === 1,
      sameSong: (left, right) => flags[2 * count + left * count + right] === 1
    };
  } catch {
    core = null;
    unavailable();
    return null;
  }
}

// src/shared/utils/waveHistoryLimits.ts
var WAVE_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1e3;

// src/shared/utils/waveQueue.ts
var TEMPO_EDIT_TITLE = /\b(?:slowed|sped[\s-]*up|speed[\s-]*up|speedup|nightcore|daycore|bass[\s-]*boost(?:ed)?)\b/i;
function isWaveTempoEdit(track) {
  return TEMPO_EDIT_TITLE.test(track.title || "");
}
function isWaveMoodMismatch(track, mood) {
  return mood === "energy" && /\b(?:slowed|daycore|acoustic)\b|акустик|замедлен/i.test(track.title || "");
}
function waveVersionPenalty(track) {
  if (isWaveTempoEdit(track)) return 18;
  if (/\b(?:live|acoustic|cover)\b|кавер|акустик/i.test(track.title || "")) return 8;
  if (/\b(?:remix|bootleg|mashup)\b/i.test(track.title || "")) return 3;
  return /\bremaster(?:ed)?\b/i.test(track.title || "") ? 1 : 0;
}
function sequenceWaveTracks(tracks, mood, familiarArtists, limit = 25, options = {}) {
  return withWaveTextCache(
    () => sequenceWaveTracksUncached(tracks, mood, familiarArtists, limit, options)
  );
}
function sequenceWaveTracksUncached(tracks, mood, familiarArtists, limit = 25, options = {}) {
  const familiar = new Set(familiarArtists.flatMap(getWaveArtistNames).map(normalizeWaveArtist));
  const knownArtists = [
    .../* @__PURE__ */ new Set([
      ...familiarArtists,
      ...tracks.flatMap(getWaveArtistNames),
      ...(options.recentTracks || []).flatMap(getWaveArtistNames)
    ])
  ];
  const recentSongs = (options.recentTracks || []).map(
    (track) => buildWaveSongIdentity(track, knownArtists)
  );
  const offeredSongs = (options.offeredTracks || []).map(
    (track) => buildWaveSongIdentity(track, knownArtists)
  );
  const offeredArtists = (options.offeredTracks || []).slice(-25).map((track) => getWaveArtistKeys(track, knownArtists));
  const scoreMusic = createWaveMusicScorer(
    options.tasteTracks,
    options.positiveTracks,
    options.skippedTracks,
    options.learnedTracks
  );
  const likedSeeds = (options.tasteTracks || []).filter((track) => track.waveSeedWeight === 2);
  const likedArtists = new Set(
    likedSeeds.flatMap((track) => getWaveArtistKeys(track, knownArtists))
  );
  const likedSongs = likedSeeds.map((track) => buildWaveSongIdentity(track, knownArtists));
  const likedIds = new Set(likedSeeds.map((track) => String(track.id)));
  const isLikedSong = (track) => track.waveSeedWeight === 2 || likedIds.has(String(track.id)) || likedSongs.some((liked) => areSameWaveSong(liked, buildWaveSongIdentity(track, knownArtists)));
  const skippedIds = new Set((options.skippedTracks || []).map((track) => String(track.id)));
  const lastHeard = [...options.recentTracks || []].reverse().find((track) => !skippedIds.has(String(track.id)));
  let previousMusic = lastHeard ? waveMusicProfile(lastHeard) : void 0;
  const prepared = tracks.filter(
    (track) => !track.playbackUnavailable && !isWaveNonMusic(track) && !isWaveMoodMismatch(track, mood)
  ).map((track, matrixIndex) => {
    const artists = getWaveArtistKeys(track, knownArtists);
    const song = buildWaveSongIdentity(track, knownArtists);
    const versionPenalty = waveVersionPenalty(track);
    const versionPriority = versionPenalty + (artists.some((artist) => familiar.has(artist)) ? 0 : 0.5);
    const music = waveMusicProfile(track);
    return {
      track,
      artists,
      song,
      liked: isLikedSong(track),
      matrixIndex,
      music,
      musicScore: scoreMusic(music, mood) + (options.libraryGenres ? libraryGenreAffinity(music.styles, options.libraryGenres) : boundedLibraryGenreScore(track.waveGenreScore)),
      likeScore: artists.some((artist) => likedArtists.has(artist)) ? likedSongs.some((liked) => areSameWaveSong(liked, song)) ? 2 : 1 : 0,
      exposurePenalty: 0,
      versionPenalty,
      versionPriority
    };
  });
  const matrix = createWaveSongMatrix(
    prepared.map((candidate) => candidate.song),
    recentSongs,
    offeredSongs
  );
  for (const candidate of prepared) {
    const exposed = matrix ? matrix.wasOffered(candidate.matrixIndex) : offeredSongs.some((offered) => areSameWaveSong(offered, candidate.song));
    candidate.exposurePenalty = (exposed ? 8 : 0) + Math.min(
      4,
      offeredArtists.filter((keys) => keys.some((key) => candidate.artists.includes(key))).length
    );
  }
  const candidates = prepared.filter(
    (candidate) => !(matrix ? matrix.wasHeard(candidate.matrixIndex) : recentSongs.some((recent2) => areSameWaveSong(recent2, candidate.song)))
  );
  const sameSong = (left, right) => matrix ? matrix.sameSong(left.matrixIndex, right.matrixIndex) : areSameWaveSong(left.song, right.song);
  const remaining = candidates.filter(
    (candidate) => !candidates.some(
      (other) => other.versionPriority < candidate.versionPriority && sameSong(candidate, other)
    )
  );
  const result = [];
  const artistCounts = /* @__PURE__ */ new Map();
  const recent = (options.recentArtists || []).slice(-40).map((name) => getWaveArtistKeys({ artist: name }));
  if (options.recentTracks?.length) {
    recent.push(
      ...options.recentTracks.slice(-40).map((track) => getWaveArtistKeys(track, knownArtists))
    );
  }
  for (const keys of recent.slice(-40))
    for (const artist of keys) artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
  const noveltyTarget = waveDiscoveryTarget(mood, options.discoveryAdjustment);
  const phase = mood === "discover" ? 0.75 : 0;
  const offset = Number.isFinite(options.sequenceOffset) ? Math.max(0, Math.floor(options.sequenceOffset)) : 0;
  let previousLiked = Boolean(
    options.recentTracks?.length && isLikedSong(options.recentTracks[options.recentTracks.length - 1])
  );
  while (remaining.length > 0 && result.length < limit) {
    const spaceLikes = mood !== "favorites" && previousLiked && remaining.some((candidate) => !candidate.liked);
    const previousSource = result[result.length - 1]?.source;
    const position = offset + result.length;
    const wantsFamiliar = Math.floor((position + 1) * noveltyTarget + phase + 1e-9) === Math.floor(position * noveltyTarget + phase + 1e-9);
    let bestIndex = 0;
    let bestScore = -Infinity;
    const ranking = {
      familiar,
      wantsFamiliar,
      recent,
      previousSource,
      previousMusic,
      mood,
      artistCounts,
      artistFeedback: options.artistFeedback
    };
    for (let index = 0; index < remaining.length; index++) {
      if (spaceLikes && remaining[index].liked) continue;
      const score = scoreWaveCandidate(remaining[index], index, ranking);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    result.push(chosen.track);
    previousLiked = chosen.liked;
    previousMusic = chosen.music;
    recent.push(chosen.artists);
    for (const artist of chosen.artists)
      artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    for (let index = remaining.length - 1; index >= 0; index--) {
      if (sameSong(chosen, remaining[index])) remaining.splice(index, 1);
    }
  }
  return result;
}
export {
  initializeRustCompute,
  sequenceWaveTracks
};
