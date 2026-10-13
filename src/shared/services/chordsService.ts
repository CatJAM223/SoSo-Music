import { setBoundedCacheEntry } from '../utils/boundedCache.ts';
import type { GuitarChordData } from '../types';

export class ChordsService {
  private static cache = new Map<string, GuitarChordData | null>();
  private static MAX_CACHE_SIZE = 200;

  private static cleanQuery(str: string): string {
    return (str || '')
      .replace(
        /\([^)]*(feat|ft|remaster|live|deluxe|version|edit|edition|mono|stereo|official)[^)]*\)/gi,
        '',
      )
      .replace(
        /\[[^\]]*(feat|ft|remaster|live|deluxe|version|edit|edition|mono|stereo|official)[^\]]*\]/gi,
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

    // Title match: exact or high overlap
    const titleExact = cT === tT || cT.includes(tT) || tT.includes(cT);
    const tWords = tT.split(' ').filter((w) => w.length > 1);
    const cWords = cT.split(' ').filter((w) => w.length > 1);
    const commonTitleWords = tWords.filter((w) => cWords.includes(w));
    const titleGood =
      titleExact ||
      (tWords.length > 0 && commonTitleWords.length >= Math.ceil(tWords.length * 0.6));

    if (!titleGood) return false;

    // Artist match: substring or high overlap
    const artistExact = cA === tA || cA.includes(tA) || tA.includes(cA);
    const aWords = tA.split(' ').filter((w) => w.length > 1);
    const caWords = cA.split(' ').filter((w) => w.length > 1);
    const commonArtistWords = aWords.filter((w) => caWords.includes(w));
    const artistGood =
      artistExact ||
      (aWords.length > 0 && commonArtistWords.length >= Math.ceil(aWords.length * 0.5));

    return artistGood;
  }

  private static decodeHtml(html: string): string {
    if (!html) return '';
    return html
      .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#039;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&laquo;/g, '«')
      .replace(/&raquo;/g, '»')
      .replace(/&ndash;/g, '–')
      .replace(/&mdash;/g, '—')
      .replace(/\[\/?(b|i|u|s|sub|sup)\]/gi, '');
  }

  /**
   * Main entry point: Fetch chords for a given track
   * Uses multi-tiered search: Ultimate Guitar -> AmDm (for RU)
   */
  public static async getChords(title: string, artist: string): Promise<GuitarChordData | null> {
    if (!title || !artist) return null;

    const cleanT = this.cleanQuery(title);
    const cleanA = this.cleanQuery(artist);
    const cacheKey = `${cleanA.toLowerCase()}:${cleanT.toLowerCase()}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) || null;
    }

    try {
      // 1. Try Ultimate Guitar first
      const ugData = await this.fetchUltimateGuitar(cleanT, cleanA);
      if (ugData) {
        setBoundedCacheEntry(this.cache, cacheKey, ugData, this.MAX_CACHE_SIZE);
        return ugData;
      }

      // 2. Fallback for Russian / Cyrillic tracks (AmDm.ru)
      if (/[а-яА-ЯёЁ]/.test(cleanT) || /[а-яА-ЯёЁ]/.test(cleanA)) {
        const amdmData = await this.fetchAmDm(cleanT, cleanA);
        if (amdmData) {
          setBoundedCacheEntry(this.cache, cacheKey, amdmData, this.MAX_CACHE_SIZE);
          return amdmData;
        }
      }

      setBoundedCacheEntry(this.cache, cacheKey, null, this.MAX_CACHE_SIZE);
      return null;
    } catch (e) {
      console.warn('[ChordsService] Failed to fetch chords:', e);
      return null;
    }
  }

  private static async fetchText(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          ...headers,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return await res.text();
      }
    } catch (e) {
      console.debug('[ChordsService] fetchText error:', e);
    }
    return null;
  }

  private static async fetchUltimateGuitar(
    title: string,
    artist: string,
  ): Promise<GuitarChordData | null> {
    try {
      const q = encodeURIComponent(`${artist} ${title}`.trim());
      const searchUrl = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${q}`;

      const html = await this.fetchText(searchUrl, {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      });
      if (!html) return null;

      const idx = html.indexOf('class="js-store" data-content="');
      if (idx === -1) return null;

      const start = idx + 'class="js-store" data-content="'.length;
      const end = html.indexOf('"></div>', start);
      if (end === -1) return null;

      const jsonStr = this.decodeHtml(html.slice(start, end));
      const data = JSON.parse(jsonStr);
      const results: any[] = data?.store?.page?.data?.results || [];

      // Filter for Chords types AND strictly verify song name & artist name
      const chordCandidates = results.filter((r) => {
        if (!r || (r.type !== 'Chords' && r.type_name !== 'Chords')) return false;
        return this.isStrictMatch(r.song_name, r.artist_name, title, artist);
      });

      if (chordCandidates.length === 0) return null;

      chordCandidates.sort(
        (a, b) => (b.votes || 0) * (b.rating || 1) - (a.votes || 0) * (a.rating || 1),
      );
      const best = chordCandidates[0];
      if (!best || !best.tab_url) return null;

      // Fetch the full tab page
      const tabHtml = await this.fetchText(best.tab_url);
      if (!tabHtml) return null;

      const tabIdx = tabHtml.indexOf('class="js-store" data-content="');
      if (tabIdx === -1) return null;

      const tStart = tabIdx + 'class="js-store" data-content="'.length;
      const tEnd = tabHtml.indexOf('"></div>', tStart);
      if (tEnd === -1) return null;

      const tJson = JSON.parse(this.decodeHtml(tabHtml.slice(tStart, tEnd)));
      const tabView = tJson?.store?.page?.data?.tab_view;
      const wikiTab = tabView?.wiki_tab;

      if (!wikiTab || !wikiTab.content) return null;

      return {
        title: best.song_name || title,
        artist: best.artist_name || artist,
        key: tabView.meta?.tonality_name || wikiTab.tonality_name || undefined,
        tuning: tabView.meta?.tuning?.value || wikiTab.tuning || 'Стандартный (E A D G B E)',
        capo: typeof tabView.meta?.capo === 'number' ? tabView.meta.capo : wikiTab.capo || 0,
        difficulty: tabView.meta?.difficulty || wikiTab.difficulty || undefined,
        rating: Math.round((best.rating || 5) * 10) / 10,
        votes: best.votes || 0,
        tabUrl: best.tab_url,
        source: 'ultimate-guitar',
        rawContent: this.decodeHtml(wikiTab.content),
      };
    } catch (e) {
      console.warn('[ChordsService] Ultimate Guitar fetch error:', e);
      return null;
    }
  }

  private static async fetchAmDm(title: string, artist: string): Promise<GuitarChordData | null> {
    try {
      const q = encodeURIComponent(`${artist} ${title}`.trim());
      const searchUrl = `https://amdm.ru/search/?q=${q}`;

      const html = await this.fetchText(searchUrl);
      if (!html) return null;

      // Parse table rows on amdm search page to find matching song and artist
      const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      let matchedSongUrl: string | null = null;
      let matchedArtistName = artist;
      let matchedSongName = title;

      for (const row of rows) {
        const artistMatch = row.match(/class="artist"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
        const songMatch = row.match(
          /class="song"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/i,
        );
        if (artistMatch && songMatch) {
          const rowArtist = artistMatch[1].trim();
          const rowUrl = songMatch[1].trim();
          const rowSong = songMatch[2].trim();
          if (this.isStrictMatch(rowSong, rowArtist, title, artist)) {
            const normalizedPath = rowUrl.startsWith('/') ? rowUrl : `/${rowUrl}`;
            matchedSongUrl = rowUrl.startsWith('//')
              ? `https:${rowUrl}`
              : rowUrl.startsWith('http')
                ? rowUrl
                : `https://amdm.ru${normalizedPath}`;
            matchedArtistName = rowArtist;
            matchedSongName = rowSong;
            break;
          }
        }
      }

      if (!matchedSongUrl) return null;

      const songHtml = await this.fetchText(matchedSongUrl);
      if (!songHtml) return null;

      // Extract chords block
      const textMatch = songHtml.match(/<pre[^>]*itemprop="text"[^>]*>([\s\S]*?)<\/pre>/i);
      if (!textMatch) return null;

      // Convert amdm format to standard [ch]Chord[/ch] tags
      const content = textMatch[1]
        .replace(/<span class="ch">([^<]+)<\/span>/gi, '[ch]$1[/ch]')
        .replace(/<[^>]+>/g, '');

      return {
        title: matchedSongName,
        artist: matchedArtistName,
        key: undefined,
        tuning: 'Стандартный (E A D G B E)',
        capo: 0,
        difficulty: undefined,
        rating: 4.8,
        votes: 150,
        tabUrl: matchedSongUrl,
        source: 'amdm',
        rawContent: this.decodeHtml(content),
      };
    } catch (e) {
      console.warn('[ChordsService] AmDm fetch error:', e);
      return null;
    }
  }
}
