import type { Track } from '../types/index.ts';
import { isArtistMatch, isTitleMatch } from './artistParser.ts';

/** Shared search relevance and duplicate filtering for desktop and mobile. */
export function rankSearchTracks(tracks: Track[], query: string): Track[] {
  const qLower = query.toLowerCase().trim();
  const qTokens = qLower.split(/\s+/).filter(Boolean);

  // Detect artist - title split format, e.g. "madk1d - дырки в штанах"
  const delimiterMatch = query.match(/\s*[-—–:]\s*/);
  let queryArtistPart = '';
  let queryTitlePart = '';
  if (delimiterMatch && delimiterMatch.index !== undefined) {
    const idx = delimiterMatch.index;
    queryArtistPart = query.substring(0, idx).trim().toLowerCase();
    queryTitlePart = query
      .substring(idx + delimiterMatch[0].length)
      .trim()
      .toLowerCase();
  }

  const isJunkQuery = (term: string) => qLower.includes(term);

  const scored = tracks.map((track) => {
    let score = 50;
    const titleLower = (track.title || '').toLowerCase().trim();
    const artistLower = (typeof track.artist === 'object' ? track.artist?.name : track.artist || '')
      .toLowerCase()
      .trim();
    const albumLower = (track.album?.title || '').toLowerCase().trim();

    // 0. High-precision split query matching: "artist - title" or "title - artist"
    if (queryArtistPart && queryTitlePart) {
      const directMatch =
        (isArtistMatch(artistLower, queryArtistPart) || artistLower.includes(queryArtistPart)) &&
        (isTitleMatch(titleLower, queryTitlePart) || titleLower.includes(queryTitlePart));
      const reverseMatch =
        (isArtistMatch(artistLower, queryTitlePart) || artistLower.includes(queryTitlePart)) &&
        (isTitleMatch(titleLower, queryArtistPart) || titleLower.includes(queryArtistPart));

      if (directMatch || reverseMatch) {
        score += 170;
        if (
          (artistLower === queryArtistPart && titleLower === queryTitlePart) ||
          (artistLower === queryTitlePart && titleLower === queryArtistPart)
        ) {
          score += 70;
        }
      }

      // Check if track artist is the authentic artist versus a random YouTube channel
      const artistMatchesTrackArtist =
        isArtistMatch(artistLower, queryArtistPart) ||
        artistLower.includes(queryArtistPart) ||
        isArtistMatch(artistLower, queryTitlePart) ||
        artistLower.includes(queryTitlePart);

      if (!artistMatchesTrackArtist) {
        // Channel is e.g. "Sanchez3d19" or "SmokeSipper", while title has artist name - this is a user reupload!
        if (titleLower.includes(queryArtistPart) && titleLower.includes(queryTitlePart)) {
          score -= 55;
        }
      } else {
        // Verified authentic artist performing the track
        score += 65;
      }
    }

    // Check combined strings: "artist - title", "title - artist", "artist title"
    const combinedA = `${artistLower} - ${titleLower}`;
    const combinedB = `${titleLower} - ${artistLower}`;
    const combinedC = `${artistLower} ${titleLower}`;
    const combinedD = `${titleLower} ${artistLower}`;
    if (
      combinedA === qLower ||
      combinedB === qLower ||
      combinedC === qLower ||
      combinedD === qLower
    ) {
      score += 160;
    }

    // 1. Exact query matches
    if (titleLower === qLower || artistLower === qLower) {
      score += 65;
    } else if (titleLower.startsWith(qLower) || artistLower.startsWith(qLower)) {
      score += 40;
    } else if (titleLower.includes(qLower) || artistLower.includes(qLower)) {
      score += 25;
    }

    // 2. Token matching (ratio of query words found)
    let tokensMatched = 0;
    for (const token of qTokens) {
      if (titleLower.includes(token) || artistLower.includes(token) || albumLower.includes(token)) {
        tokensMatched++;
      }
    }
    score += (tokensMatched / Math.max(1, qTokens.length)) * 40;

    // 3. Official album boost
    if (
      track.album?.title &&
      track.album.title !== 'Single' &&
      track.album.title !== 'Unknown Album'
    ) {
      score += 15;
    }

    // 4. Source / Quality (Favor official YouTube studio recordings)
    if (track.source === 'youtube') {
      score += 30;
    } else if (track.source === 'soundcloud') {
      if ((track as any).user?.verified) {
        score += 10;
      } else {
        score -= 5;
      }
    }

    // 5. Heavy penalties for noise/junk results
    if (
      !isJunkQuery('hour') &&
      !isJunkQuery('loop') &&
      /(\b\d+\s*hours?\b|\b1\s*hour\b|\b10\s*hours\b|\bloop\b)/i.test(titleLower)
    ) {
      score -= 75;
    }

    if (
      !isJunkQuery('podcast') &&
      !isJunkQuery('reaction') &&
      /(\bpodcast\b|\breaction\b|\bvoiceover\b|\bskit\b|\bmeme\b)/i.test(titleLower)
    ) {
      score -= 60;
    }

    if (
      !isJunkQuery('karaoke') &&
      !isJunkQuery('караоке') &&
      !isJunkQuery('type beat') &&
      !isJunkQuery('instrumental') &&
      !isJunkQuery('минус')
    ) {
      if (
        /(\bkaraoke\b|\bкараоке\b|\bbacking track\b|\btype beat\b|\bминусовка\b|\bминус\b)/i.test(
          titleLower,
        )
      ) {
        score -= 50;
      }
    }

    if (
      !isJunkQuery('bass boosted') &&
      !isJunkQuery('nightcore') &&
      !isJunkQuery('slowed') &&
      !isJunkQuery('reverb') &&
      !isJunkQuery('speed')
    ) {
      if (
        /(\bbass boosted\b|\bnightcore\b|\bslowed\s*\+\s*reverb\b|\bsped up\b)/i.test(titleLower)
      ) {
        score -= 30;
      }
    }

    // 6. Penalties for mashups, bootlegs, covers and fan edits
    if (
      !isJunkQuery('mashup') &&
      !isJunkQuery('мешап') &&
      !isJunkQuery('medley') &&
      !isJunkQuery('megamix')
    ) {
      if (
        /(\bmashup\b|\bмешап\b|\bmedley\b|\bmegamix\b|\bsuper mix\b|\bultimate mix\b)/i.test(
          titleLower,
        )
      ) {
        score -= 65;
      }
    }

    if (
      !isJunkQuery('bootleg') &&
      !isJunkQuery('fan') &&
      !isJunkQuery('tribute') &&
      !isJunkQuery('unofficial')
    ) {
      if (
        /(\bbootleg\b|\bfan.?made\b|\bfan edit\b|\btribute\b|\bunofficial\b|\bunauthorized\b)/i.test(
          titleLower,
        )
      ) {
        score -= 60;
      }
    }

    if (!isJunkQuery('cover') && !isJunkQuery('кавер')) {
      if (
        /(\bcover version\b|\bкавер\b|\bкавер-версия\b|\bcovers\b|\(cover\)|\[cover\])/i.test(
          titleLower,
        )
      ) {
        score -= 55;
      }
    }

    // 7. Penalty for excessive featured artists / producer tags (sign of garbage compilations)
    if (!isJunkQuery('prod.') && !isJunkQuery('prod ')) {
      if (/\bprod\.?\s+by\b|\bprod\.\s*[A-Za-zА-ЯёА-яё]/i.test(titleLower)) {
        score -= 25;
      }
    }

    // Count ft./feat. tokens — 3+ usually means a mashup or garbage compilation
    const featMatches = (titleLower.match(/\b(ft\.?|feat\.?|featuring)\b/gi) || []).length;
    if (featMatches >= 3) {
      score -= 45;
    }

    const dur = track.duration || 0;
    if (dur > 900) {
      if (!isJunkQuery('mix') && !isJunkQuery('set') && !isJunkQuery('full album')) {
        score -= 50;
      }
    } else if (dur > 0 && dur < 35) {
      score -= 40;
    }

    // 8. Bonus for typical studio single duration (150–360 seconds)
    if (dur >= 150 && dur <= 360) {
      score += 10;
    }

    return { track, score };
  });

  // Deduplicate by normalized title and artist
  const seen = new Set<string>();
  const deduplicated: Array<{ track: Track; score: number }> = [];

  for (const item of scored) {
    const t = item.track;
    const key = `${(t.title || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '')}_${(typeof t.artist === 'object' ? t.artist?.name : t.artist || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '')}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(item);
    }
  }

  // Sort by score descending
  deduplicated.sort((a, b) => b.score - a.score);

  return deduplicated.map((x) => x.track);
}
