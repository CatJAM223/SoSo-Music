/**
 * Utility to parse and split collaborating/featured artists from a raw track artist string and track title.
 */
export function parseMultiArtists(rawName: string): string[] {
  if (!rawName || typeof rawName !== 'string') return [];
  const clean = rawName.trim();
  if (!clean) return [];

  // Protect known single-band names with special characters
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

  // Replace featuring indicators and separators with uniform delimiter
  const normalized = clean
    .replace(/\s*(?:при\s+уч(?:\.|астии)?|уч\.)\s*/gi, ' § ')
    .replace(/(?:^|\s)(?:featuring|feat\.?|ft\.?|with|vs\.?)(?=\s|$)\s*/gi, ' § ')
    .replace(/\s*&\s*/g, ' § ')
    .replace(/\s*\/\s*/g, ' § ')
    .replace(/\s+x\s+/gi, ' § ')
    .replace(/\s*,\s*/g, ' § ');

  const parts = normalized
    .split('§')
    .map((p) => p.replace(/^[\(\[\{\)\]\}]+|[\(\[\{\)\]\}]+$/g, '').trim())
    .filter((p) => p.length > 0);

  // Deduplicate case-insensitively while preserving original casing
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(p);
    }
  }

  return unique.length > 0 ? unique : [clean];
}

/**
 * Extracts all artists from track artist and any embedded featuring credits in the track title.
 */
export function extractAllArtists(trackOrArtist: any, titleStr?: string): string[] {
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

  const artists: string[] = [];
  const seen = new Set<string>();

  const addArtist = (name: string) => {
    const trimmed = name.replace(/^[\(\[\{\)\]\}]+|[\(\[\{\)\]\}]+$/g, '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      artists.push(trimmed);
    }
  };

  // 1. Parse main artist field
  if (rawArtist) {
    const parsedMain = parseMultiArtists(rawArtist);
    parsedMain.forEach(addArtist);
  }

  // 2. Check track title for embedded (feat. / ft. / featuring / при уч. / уч. / vs. / with) credits
  if (rawTitle) {
    // A. Parenthesized / Bracketed featuring (e.g. "Song (feat. Artist)", "Song [ft. Artist]")
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

export function parseArtists(rawName: string | any, titleStr?: string): { name: string }[] {
  return extractAllArtists(rawName, titleStr).map((name) => ({ name }));
}

export function normalizeText(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

export function cleanTitleForMatching(rawTitle: string): string {
  return (rawTitle || '')
    .replace(
      /\([^)]*(feat|remaster|live|deluxe|version|edit|edition|mono|stereo|official)[^)]*\)/gi,
      '',
    )
    .replace(
      /\[[^\]]*(feat|remaster|live|deluxe|version|edit|edition|mono|stereo|official)[^\]]*\]/gi,
      '',
    )
    .replace(/-\s*(remaster|live|deluxe|radio|single).*/gi, '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isArtistMatch(cand: any, targetArtist: string): boolean {
  if (!cand || !targetArtist) return false;
  const normTarget = normalizeText(targetArtist);
  if (!normTarget) return true;

  const candArtistName =
    typeof cand.artist === 'object' ? cand.artist?.name : cand.artist || cand.user?.username || '';
  const candTitle = cand.title || '';
  const candPublisherArtist = cand.publisher_metadata?.artist || '';

  const normCandArtist = normalizeText(candArtistName);
  const normCandPub = normalizeText(candPublisherArtist);
  const normCandTitle = normalizeText(candTitle);

  // 1. Direct artist / username / publisher match
  if (
    normCandArtist &&
    (normCandArtist.includes(normTarget) || normTarget.includes(normCandArtist))
  ) {
    return true;
  }
  if (normCandPub && (normCandPub.includes(normTarget) || normTarget.includes(normCandPub))) {
    return true;
  }

  // 2. Artist name inside candidate title (e.g. "Headplate - Jump The Bridge", "Delicate (Headplate)")
  if (normCandTitle.includes(normTarget)) {
    return true;
  }

  // 3. Multi-artist checks (for collabs like 'Artist1 & Artist2' or 'feat. Artist')
  const targetParts = targetArtist
    .split(/[,&/]|\\bfeat\\.?\\b|\\bwith\\b/i)
    .map(normalizeText)
    .filter(Boolean);
  for (const p of targetParts) {
    if (
      p.length >= 3 &&
      (normCandArtist.includes(p) || normCandTitle.includes(p) || normCandPub.includes(p))
    ) {
      return true;
    }
  }

  return false;
}

export function isTitleMatch(candTitle: string, targetTitle: string): boolean {
  if (!candTitle || !targetTitle) return false;
  const cleanTarget = normalizeText(cleanTitleForMatching(targetTitle));
  const cleanCand = normalizeText(cleanTitleForMatching(candTitle));
  if (!cleanTarget) return true;

  // Direct normalized substring match
  if (cleanCand.includes(cleanTarget) || cleanTarget.includes(cleanCand)) {
    return true;
  }

  // Word token overlap match (>= 75% of meaningful target words)
  const targetWords = cleanTitleForMatching(targetTitle)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  if (targetWords.length === 0) return true;
  const candLower = candTitle.toLowerCase();
  const matchedWords = targetWords.filter((w) => candLower.includes(w));
  return matchedWords.length / targetWords.length >= 0.75;
}

/**
 * Normalizes artist profile details ensuring topTracks and albums are safe arrays
 */
export function normalizeArtistDetails(res: any): any {
  if (!res) return null;
  return {
    ...res,
    topTracks: Array.isArray(res.topTracks) ? res.topTracks : [],
    albums: Array.isArray(res.albums) ? res.albums : [],
  };
}
