import { setBoundedCacheEntry } from '../utils/boundedCache.ts';
import type { SongsterrTabData, SongsterrTrack } from '../types';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midi: number): string {
  if (typeof midi !== 'number' || isNaN(midi)) return '';
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

export function formatSongsterrTuning(tuning?: number[]): string {
  if (!Array.isArray(tuning) || tuning.length === 0) {
    return 'Стандартный (E A D G B E)';
  }

  // Songsterr tuning arrays are ordered from highest pitch (string 1) to lowest pitch (string 6)
  // We reverse to present from lowest string to highest (e.g. E A D G B E)
  const notes = [...tuning].reverse().map(midiToNoteName);
  const str = notes.join(' ');

  // Standard 6-string guitar tunings
  if (str === 'E A D G B E') return 'Стандартный (E A D G B E)';
  if (str === 'D A D G B E') return 'Drop D (D A D G B E)';
  if (str === 'D# G# C# F# A# D#' || str === 'Eb Ab Db Gb Bb Eb')
    return 'Half-Step Down (Eb Ab Db Gb Bb Eb)';
  if (str === 'D G C F A D') return 'D Standard (D G C F A D)';
  if (str === 'C# F# B E G# C#') return 'Drop C# (C# G# C# F# A# D#)';
  if (str === 'C G C F A D') return 'Drop C (C G C F A D)';
  if (str === 'B F# B E G# C#') return 'Drop B (B F# B E G# C#)';
  if (str === 'B E A D F# B') return 'B Standard (B E A D F# B)';
  if (str === 'A# D# G# C# F A#' || str === 'Bb Eb Ab Db F Bb') return 'Drop A# (Bb F Bb Eb G C)';

  // 4-string and 5-string Bass tunings
  if (str === 'E A D G') return 'Стандартный бас (E A D G)';
  if (str === 'D A D G') return 'Drop D бас (D A D G)';
  if (str === 'D# G# C# F#' || str === 'Eb Ab Db Gb') return 'Half-Step Down бас (Eb Ab Db Gb)';
  if (str === 'B E A D G') return '5-струнный бас (B E A D G)';
  if (str === 'A E A D G') return 'Drop A бас (A E A D G)';

  // 7-string Guitar tunings
  if (str === 'B E A D G B E') return '7-струнный стандарт (B E A D G B E)';
  if (str === 'A E A D G B E') return 'Drop A 7-струнный (A E A D G B E)';

  return str ? `Строй: ${str}` : 'Стандартный';
}

export class SongsterrService {
  public static formatTuning(tuning?: number[]): string {
    return formatSongsterrTuning(tuning);
  }

  private static cache = new Map<string, SongsterrTabData | null>();
  private static MAX_CACHE_SIZE = 200;

  private static cleanQuery(str: string): string {
    return (str || '')
      .replace(
        /\([^)]*(feat|ft|remaster|live|deluxe|version|edit|edition|mono|stereo|official|bonus)[^)]*\)/gi,
        '',
      )
      .replace(
        /\[[^\]]*(feat|ft|remaster|live|deluxe|version|edit|edition|mono|stereo|official|bonus)[^\]]*\]/gi,
        '',
      )
      .replace(/-\s*(remaster|live|deluxe|single|radio).*/gi, '')
      .replace(/[^a-zA-Z0-9а-яА-ЯёЁ\s'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static normalize(str: string): string {
    return (str || '')
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static isStrictMatch(
    candTitle: string,
    candArtist: string,
    targetTitle: string,
    targetArtist: string,
  ): boolean {
    const cT = this.normalize(candTitle);
    const cA = this.normalize(candArtist);
    const tT = this.normalize(targetTitle);
    const tA = this.normalize(targetArtist);

    if (!cT || !tT || !cA || !tA) return false;

    // Title match: exact or contains
    const titleExact = cT === tT || cT.includes(tT) || tT.includes(cT);
    const tWords = tT.split(' ').filter((w) => w.length > 1);
    const cWords = cT.split(' ').filter((w) => w.length > 1);
    const commonTitleWords = tWords.filter((w) => cWords.includes(w));
    const titleGood =
      titleExact ||
      (tWords.length > 0 && commonTitleWords.length >= Math.ceil(tWords.length * 0.6));

    if (!titleGood) return false;

    // Artist match: exact or contains
    const artistExact = cA === tA || cA.includes(tA) || tA.includes(cA);
    const aWords = tA.split(' ').filter((w) => w.length > 1);
    const caWords = cA.split(' ').filter((w) => w.length > 1);
    const commonArtistWords = aWords.filter((w) => caWords.includes(w));
    const artistGood =
      artistExact ||
      (aWords.length > 0 && commonArtistWords.length >= Math.ceil(aWords.length * 0.5));

    return artistGood;
  }

  private static async fetchJson(url: string): Promise<any> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.debug('[SongsterrService] fetchJson error:', e);
      return null;
    }
  }

  /**
   * Search for guitar/bass tabs on Songsterr open API
   */
  public static async getSongTab(title: string, artist: string): Promise<SongsterrTabData | null> {
    if (!title) return null;

    const cleanT = this.cleanQuery(title);
    const cleanA = this.cleanQuery(artist);
    const cacheKey = `${this.normalize(cleanA)}_${this.normalize(cleanT)}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      // 1. Try search with both artist and title
      let queryPattern = `${cleanA} ${cleanT}`.trim();
      let searchUrl = `https://www.songsterr.com/api/songs?pattern=${encodeURIComponent(queryPattern)}`;
      let songs = await this.fetchJson(searchUrl);

      // 2. If no direct results, try title only
      if (!Array.isArray(songs) || songs.length === 0) {
        queryPattern = cleanT;
        searchUrl = `https://www.songsterr.com/api/songs?pattern=${encodeURIComponent(queryPattern)}`;
        songs = await this.fetchJson(searchUrl);
      }

      if (!Array.isArray(songs) || songs.length === 0) {
        setBoundedCacheEntry(this.cache, cacheKey, null, this.MAX_CACHE_SIZE);
        return null;
      }

      // Filter and rank matches
      const candidates = songs.filter((s: any) => {
        if (!s || !s.songId || !s.title || !s.artist) return false;
        return this.isStrictMatch(s.title, s.artist, cleanT, cleanA);
      });

      const matchedSong = candidates.length > 0 ? candidates[0] : songs[0];
      if (!matchedSong || !matchedSong.songId) {
        setBoundedCacheEntry(this.cache, cacheKey, null, this.MAX_CACHE_SIZE);
        return null;
      }

      // Transform tracks list
      const rawTracks = Array.isArray(matchedSong.tracks) ? matchedSong.tracks : [];
      const tracks: SongsterrTrack[] = rawTracks.map((t: any) => {
        return {
          instrumentId: t.instrumentId,
          instrument: t.instrument || 'Guitar',
          name: t.name || t.instrument || 'Guitar Track',
          tuning: formatSongsterrTuning(t.tuning),
          rawTuning: Array.isArray(t.tuning) ? t.tuning : undefined,
          difficulty: typeof t.difficulty === 'number' ? t.difficulty : undefined,
          views: typeof t.views === 'number' ? t.views : undefined,
        };
      });

      const tabData: SongsterrTabData = {
        songId: matchedSong.songId,
        artistId: matchedSong.artistId,
        title: matchedSong.title || cleanT,
        artist: matchedSong.artist || cleanA,
        hasPlayer: Boolean(matchedSong.hasPlayer),
        hasChords: Boolean(matchedSong.hasChords),
        tracks,
        defaultTrackIndex:
          typeof matchedSong.defaultTrack === 'number' ? matchedSong.defaultTrack : 0,
        songsterrUrl: `https://www.songsterr.com/a/wa/song?id=${matchedSong.songId}`,
      };

      setBoundedCacheEntry(this.cache, cacheKey, tabData, this.MAX_CACHE_SIZE);
      return tabData;
    } catch (err) {
      console.warn('[SongsterrService] Failed to fetch Songsterr tabs:', err);
      setBoundedCacheEntry(this.cache, cacheKey, null, this.MAX_CACHE_SIZE);
      return null;
    }
  }
}
