export {
  cleanLyricText,
  buildKaraokeLinesWithBreaks,
} from '../../../shared/utils/karaokeProcessing.ts';
import { cleanLyricText } from '../../../shared/utils/karaokeProcessing.ts';
import type { LyricsLine } from '../../../shared/types/index.ts';
import { desktopFetch } from './desktopFetch.ts';
import {
  createLyricsCacheKey,
  getLyricsTitleMatchScore,
} from '../../../shared/utils/lyricsIdentity.ts';

const ARTIST_ALIASES: Record<string, string[]> = {
  гроб: ['Гражданская Оборона', 'Егор Летов', 'Егор и Опизденевшие'],
  'гр.об.': ['Гражданская Оборона', 'Егор Летов'],
  'гр. об.': ['Гражданская Оборона', 'Егор Летов'],
  'гр об': ['Гражданская Оборона', 'Егор Летов'],
  'гражданская оборона': ['Гражданская Оборона', 'ГрОб', 'Егор Летов'],
  'егор летов': ['Егор Летов', 'Гражданская Оборона'],
  киш: ['Король и Шут'],
  'король и шут': ['Король и Шут', 'КиШ'],
  лсп: ['ЛСП', 'LSP'],
  lsp: ['LSP', 'ЛСП'],
  'би-2': ['Би-2', 'БИ-2'],
  'би 2': ['Би-2'],
  oxxxymiron: ['Oxxxymiron', 'Оксимирон'],
  оксимирон: ['Oxxxymiron', 'Оксимирон'],
  'noize mc': ['Noize MC', 'Нойз МС'],
  'нойз мс': ['Noize MC', 'Нойз МС'],
  miyagi: ['Miyagi & Эндшпиль', 'Miyagi & Andy Panda', 'Miyagi'],
  мияви: ['Miyagi'],
  эндшпиль: ['Miyagi & Эндшпиль', 'Andy Panda'],
  'andy panda': ['Andy Panda', 'Miyagi & Andy Panda'],
  скриптонит: ['Скриптонит', 'Scriptonite'],
  scriptonite: ['Скриптонит', 'Scriptonite'],
  фараон: ['PHARAOH', 'Pharaoh'],
  pharaoh: ['PHARAOH', 'Pharaoh'],
  zivert: ['Zivert', 'Зиверт'],
  зиверт: ['Zivert', 'Зиверт'],
  кино: ['Кино', 'Виктор Цой'],
  'виктор цой': ['Виктор Цой', 'Кино'],
  сплин: ['Сплин', 'Александр Васильев'],
  'наутилус помпилиус': ['Nautilus Pompilius', 'Наутилус Помпилиус', 'Вячеслав Бутусов'],
  'nautilus pompilius': ['Nautilus Pompilius', 'Наутилус Помпилиус'],
  ддт: ['ДДТ', 'Юрий Шевчук'],
  ddt: ['ДДТ'],
  ария: ['Ария', 'Валерий Кипелов'],
  кипелов: ['Кипелов', 'Ария'],
  земфира: ['Земфира', 'Zemfira'],
  'мумий тролль': ['Мумий Тролль', 'Mumiy Troll'],
  'сектор газа': ['Сектор Газа', 'Юрий Хой'],
  пикник: ['Пикник', 'Эдмунд Шклярский'],
  'агата кристи': ['Агата Кристи', 'Вадим Самойлов', 'Глеб Самойлов'],
  порнофильмы: ['Порнофильмы'],
  'валентин стрыкало': ['Валентин Стрыкало', 'Юрий Каплан'],
  'пошлая молли': ['Пошлая Молли'],
  любэ: ['Любэ', 'Любе'],
  любе: ['Любэ', 'Любе'],
};

export class LyricsService {
  private static cache = new Map<string, { lines: LyricsLine[]; synced: boolean } | null>();
  private static readonly MAX_CACHE_SIZE = 200;

  private static setCache(key: string, val: { lines: LyricsLine[]; synced: boolean } | null): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, val);
  }

  /**
   * Heavy penalty for clearly wrong versions (live recordings, remixes,
   * sped-up / slowed edits etc.) — their timings never match the studio track.
   */
  public static versionPenalty(name: string | undefined | null): number {
    if (!name) return 0;
    const n = String(name).toLowerCase();

    // Latin tokens can use word boundaries safely
    if (
      /\b(live|unplugged|acoustic|cover|karaoke|instrumental|remix|bootleg|sped\s*up|speed\s*up|nightcore|daycore|slowed?)\b/.test(
        n,
      ) ||
      /reverb\s*\+|slowed\s*\+/.test(n)
    ) {
      return 400;
    }

    // Cyrillic markers (substring match, \b is unreliable for non-latin)
    if (
      /концерт|в живую|наживую|акустик|кавер|караоке|инструментал|ремикс|замедлен|ускорен/.test(n)
    ) {
      return 400;
    }

    // Soft version markers — mild penalty, remasters are usually fine
    if (/\b(remaster|version|vers|edit|deluxe|bonus|mono|stereo)\b/.test(n) || /версия/.test(n)) {
      return 60;
    }

    return 0;
  }

  public static scoreLyricsCandidate(
    cand: any,
    targetTitle: string,
    targetArtist: string,
    targetDuration?: number,
  ): number {
    if (!cand) return -999;

    const candArtistNorm = (cand.artistName || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
    const targetArtistNorm = (targetArtist || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');

    // Strict Title matching
    const titleScore = getLyricsTitleMatchScore(cand.trackName || '', targetTitle || '');

    // Strict Artist matching
    let artistScore = 0;
    if (candArtistNorm === targetArtistNorm) {
      artistScore = 400;
    } else if (
      (candArtistNorm.includes(targetArtistNorm) || targetArtistNorm.includes(candArtistNorm)) &&
      targetArtistNorm.length >= 3
    ) {
      artistScore = 200;
    }

    // STRICT REJECTION: Both title and artist MUST match!
    if (titleScore === 0) {
      return -999;
    }
    if (artistScore === 0) {
      return -999;
    }

    let score = titleScore + artistScore;

    // Duration difference scoring
    const candDur = cand.duration || targetDuration || 0;
    const durDiff = targetDuration && targetDuration > 0 ? Math.abs(candDur - targetDuration) : 0;
    if (durDiff <= 3) {
      score += 400;
    } else if (durDiff <= 6) {
      score += 250;
    } else if (durDiff <= 10) {
      score += 100;
    } else if (durDiff > 15) {
      score -= 300;
    }

    // Synced lyrics bonus
    if (cand.syncedLyrics) {
      if (durDiff <= 10) {
        score += 400;
      } else {
        score += 50;
      }
    } else if (cand.plainLyrics) {
      score += 50;
    }

    // Wrong-version penalty
    score -= LyricsService.versionPenalty(cand.trackName);

    return score;
  }

  private static async fetchJson(url: string, timeoutMs: number = 3500): Promise<any> {
    try {
      const res = await desktopFetch(url, {
        headers: {
          'User-Agent': 'SoSoMusic/1.0 (https://github.com/sosomusic)',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.debug('[LyricsService] fetchJson request notice:', e);
    }

    return null;
  }

  /**
   * Parse LRC format: [mm:ss.xx] Lyric text
   */
  public static parseLrc(lrcContent: string): LyricsLine[] {
    if (!lrcContent) return [];
    const lines = lrcContent.split('\n');
    const result: LyricsLine[] = [];
    const timeRegex = /\[([0-5]?\d):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;

    let globalOffsetSec = 0;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const offsetMatch = /^\[offset:\s*([+-]?\d+)\s*\]/i.exec(line);
      if (offsetMatch) {
        globalOffsetSec = parseInt(offsetMatch[1], 10) / 1000;
      }
    }

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Skip metadata headers
      if (/^\[(ar|ti|al|by|offset|length|re|ve|encoding|tool):/i.test(line)) {
        continue;
      }

      let text = cleanLyricText(line.replace(timeRegex, ''));
      text = text.replace(/\s*\/\/\s*|\s*\/\s*/g, ' ').trim();
      if (!text) continue;

      let match;
      timeRegex.lastIndex = 0;
      while ((match = timeRegex.exec(line)) !== null) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        let fraction = 0;
        if (match[3]) {
          if (match[3].length === 2) {
            fraction = parseInt(match[3], 10) / 100;
          } else if (match[3].length === 3) {
            fraction = parseInt(match[3], 10) / 1000;
          } else {
            fraction = parseFloat(`0.${match[3]}`);
          }
        }
        const time = Math.max(0, minutes * 60 + seconds + fraction + globalOffsetSec);
        result.push({ time, text });
      }
    }

    return result.sort((a, b) => a.time - b.time);
  }

  /**
   * Parse plain text into evenly spaced lyrics lines if no synced timestamps exist
   */
  /**
   * Auto-alignment: shift the whole timing grid when the recording the LRC was
   * synced to differs from the actually playing track by a constant (e.g. a
   * trimmed / extended intro). The difference is assumed to sit at the front,
   * which covers the most common master-vs-radio-edit mismatch.
   */
  public static applyAutoAlignment(
    lines: LyricsLine[],
    sourceDuration?: number | null,
    trackDuration?: number | null,
  ): LyricsLine[] {
    if (!lines || lines.length < 4) return lines;
    const src = Number(sourceDuration) || 0;
    const track = Number(trackDuration) || 0;
    if (src <= 0 || track <= 0) return lines;

    const diff = track - src; // >0 — наш трек длиннее (вступление растянули), <0 — короче (интро порезано)
    // Trust near-exact matches; ignore absurd mismatches (likely wrong version entirely)
    if (Math.abs(diff) < 2 || Math.abs(diff) > 15) return lines;

    return lines.map((l) => ({ ...l, time: Math.max(0, l.time + diff) }));
  }

  public static parsePlainLyrics(plain: string, _duration: number = 180): LyricsLine[] {
    if (!plain) return [];
    const rawLines = plain.split('\n');
    const lines: string[] = [];

    for (const raw of rawLines) {
      const cleaned = cleanLyricText(raw);
      if (
        cleaned.length > 0 &&
        !/^\[(ar|ti|al|by|offset|length|re|ve):/i.test(cleaned) &&
        !/^\[(?:verse|chorus|bridge|intro|outro|hook|pre-chorus|куплет|припев|интро|аутро)/i.test(
          cleaned,
        ) &&
        !cleaned.startsWith('---')
      ) {
        lines.push(cleaned);
      }
    }

    if (lines.length === 0) return [];
    return lines.map((text) => ({
      time: -1,
      text,
    }));
  }

  /**
   * Fetch synced lyrics from LRCLIB with artist alias expansion & exact title matching.
   * Returns lines only (backwards-compatible convenience wrapper).
   */
  public static async getLyrics(
    title: string,
    artist: string,
    duration?: number,
  ): Promise<LyricsLine[] | null> {
    const detailed = await this.getLyricsDetailed(title, artist, duration);
    return detailed ? detailed.lines : null;
  }

  /**
   * Same as getLyrics but also reports whether the result is truly time-synced
   * (LRC) or just evenly-spread plain text — used by the persistent cache layer.
   */
  public static async getLyricsDetailed(
    title: string,
    artist: string,
    duration?: number,
  ): Promise<{ lines: LyricsLine[]; synced: boolean } | null> {
    if (!title || !artist) return null;

    let cleanTitle = title
      .replace(
        /\([^)]*(feat|remaster|live|deluxe|version|edit|edition|mono|stereo|official)[^)]*\)/gi,
        '',
      )
      .replace(
        /\[[^\]]*(feat|remaster|live|deluxe|version|edit|edition|mono|stereo|official)[^\]]*\]/gi,
        '',
      )
      .replace(/-\s*(remaster|live|deluxe|single|radio).*/gi, '')
      .replace(/«|»|"/g, '')
      .trim();

    if (!cleanTitle) {
      cleanTitle = title.replace(/«|»|"/g, '').trim();
    }

    const rawPrimaryArtist = artist.split(/[,&/]/)[0].trim();
    const cleanArtist = rawPrimaryArtist.replace(/«|»|"/g, '').trim();

    const cacheKey = createLyricsCacheKey(title, artist, duration);

    if (this.cache.has(cacheKey)) {
      const val = this.cache.get(cacheKey) || null;
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, val);
      return val;
    }

    // Prepare candidate artist names using alias dictionary
    const artistLower = cleanArtist.toLowerCase();
    const candidateArtists = [cleanArtist];
    if (ARTIST_ALIASES[artistLower]) {
      candidateArtists.push(...ARTIST_ALIASES[artistLower]);
    }

    // Pool of "second chance" candidates — used only if nothing clean passes the strict path
    const fallbackPool: { cand: any; score: number; durDiff: number }[] = [];
    const pushToPool = (cand: any, score: number, durDiff: number) => {
      if (!cand || (!cand.syncedLyrics && !cand.plainLyrics)) return;
      const dedupeKey = `${String(cand.artistName || '')}|${String(cand.trackName || '')}|${cand.duration || 0}`;
      if (
        fallbackPool.some(
          (p) =>
            `${String(p.cand.artistName || '')}|${String(p.cand.trackName || '')}|${p.cand.duration || 0}` ===
            dedupeKey,
        )
      ) {
        return;
      }
      fallbackPool.push({ cand, score, durDiff });
    };

    for (const candArtist of candidateArtists) {
      try {
        // 1. Direct match endpoint
        const queryParams = new URLSearchParams({
          track_name: cleanTitle,
          artist_name: candArtist,
        });

        if (duration && duration > 0) {
          queryParams.append('duration', String(Math.round(duration)));
        }

        const directUrl = `https://lrclib.net/api/get?${queryParams.toString()}`;
        let directRes = await this.fetchJson(directUrl);
        if (!directRes?.syncedLyrics && !directRes?.plainLyrics) {
          // Fallback to LRCMux mirror (from GooseOb/music_plr)
          const muxUrl = `https://lrcmux.dev/api/get?${queryParams.toString()}`;
          const muxRes = await this.fetchJson(muxUrl, 3000);
          if (muxRes?.syncedLyrics || muxRes?.plainLyrics) {
            directRes = muxRes;
          }
        }

        if (directRes?.syncedLyrics || directRes?.plainLyrics) {
          const durDiff =
            duration && duration > 0 && directRes.duration
              ? Math.abs(directRes.duration - duration)
              : 0;
          const badVersion = this.versionPenalty(directRes.trackName);

          // Valid synced lyrics must have at least 4 lines, no huge duration mismatch (>12s)
          // and must not be an obviously wrong version (live / remix / sped-up...)
          if (directRes?.syncedLyrics && !badVersion) {
            const parsed = this.applyAutoAlignment(
              this.parseLrc(directRes.syncedLyrics),
              directRes.duration,
              duration,
            );
            if (parsed.length >= 4 && durDiff <= 12) {
              const result = { lines: parsed, synced: true };
              this.setCache(cacheKey, result);
              return result;
            }
          }

          if (directRes?.plainLyrics && !badVersion) {
            const parsed = this.parsePlainLyrics(directRes.plainLyrics, duration || 180);
            if (parsed.length > 0) {
              const result = { lines: parsed, synced: false };
              this.setCache(cacheKey, result);
              return result;
            }
          }

          pushToPool(directRes, badVersion ? 0 : 600, durDiff);
        }

        // 2. Search fallback with smart candidate ranking (parallel queries)
        const searchQueries = [`${candArtist} ${cleanTitle}`, `${cleanTitle} ${candArtist}`];

        let searchResponses = await Promise.all(
          searchQueries.map((sQuery) =>
            this.fetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(sQuery)}`, 3500),
          ),
        );

        const allCandidates: any[] = [];
        const seenCandIds = new Set<string>();
        for (const res of searchResponses) {
          if (Array.isArray(res)) {
            for (const item of res) {
              if (!item) continue;
              const key = `${item.id || ''}_${item.trackName || ''}_${item.artistName || ''}`;
              if (!seenCandIds.has(key)) {
                seenCandIds.add(key);
                allCandidates.push(item);
              }
            }
          }
        }

        // LRCMux search fallback if LRCLib search had no candidates
        if (allCandidates.length === 0) {
          const muxResponses = await Promise.all(
            searchQueries.map((sQuery) =>
              this.fetchJson(`https://lrcmux.dev/api/search?q=${encodeURIComponent(sQuery)}`, 3500),
            ),
          );
          for (const res of muxResponses) {
            if (Array.isArray(res)) {
              for (const item of res) {
                if (!item) continue;
                const key = `${item.id || ''}_${item.trackName || ''}_${item.artistName || ''}`;
                if (!seenCandIds.has(key)) {
                  seenCandIds.add(key);
                  allCandidates.push(item);
                }
              }
            }
          }
        }

        if (allCandidates.length > 0) {
          // Score candidates based on title match, artist match, duration delta,
          // synced lyrics and version cleanliness
          const scoredCandidates: { cand: any; score: number; durDiff: number }[] = [];

          for (const cand of allCandidates) {
            const score = LyricsService.scoreLyricsCandidate(
              cand,
              cleanTitle,
              candArtist,
              duration,
            );
            if (score <= 300) continue;

            const candDur = cand.duration || duration || 0;
            const durDiff = duration && duration > 0 ? Math.abs(candDur - duration) : 0;
            scoredCandidates.push({ cand, score, durDiff });
          }

          // Sort descending by score
          scoredCandidates.sort((a, b) => b.score - a.score);

          // Remember top candidates for the second pass
          scoredCandidates.slice(0, 5).forEach((s) => pushToPool(s.cand, s.score, s.durDiff));

          const best = scoredCandidates[0];
          if (best && best.score >= 500) {
            if (best.cand?.syncedLyrics && best.durDiff <= 12) {
              const parsed = this.applyAutoAlignment(
                this.parseLrc(best.cand.syncedLyrics),
                best.cand.duration,
                duration,
              );
              if (parsed.length >= 4) {
                const result = { lines: parsed, synced: true };
                this.setCache(cacheKey, result);
                return result;
              }
            }
            if (best.cand?.plainLyrics) {
              const parsed = this.parsePlainLyrics(best.cand.plainLyrics, duration || 180);
              if (parsed.length > 0) {
                const result = { lines: parsed, synced: false };
                this.setCache(cacheKey, result);
                return result;
              }
            }
          }
        }
      } catch (e) {
        console.warn('[LyricsService] Query error for candidate:', candArtist, e);
      }
    }

    // Lenient second pass: prefer ANY valid synced lyrics over plain text or nothing.
    // This keeps availability high for rare tracks while the strict path above
    // always prefers clean studio versions.
    fallbackPool.sort((a, b) => b.score - a.score);

    for (const entry of fallbackPool) {
      if (entry.score >= 500 && entry.cand?.syncedLyrics) {
        const parsed = this.applyAutoAlignment(
          this.parseLrc(entry.cand.syncedLyrics),
          entry.cand.duration,
          duration,
        );
        if (parsed.length >= 4) {
          const result = { lines: parsed, synced: true };
          this.setCache(cacheKey, result);
          return result;
        }
      }
    }
    for (const entry of fallbackPool) {
      if (entry.score >= 500 && entry.cand?.plainLyrics) {
        const parsed = this.parsePlainLyrics(entry.cand.plainLyrics, duration || 180);
        if (parsed.length > 0) {
          const result = { lines: parsed, synced: false };
          this.setCache(cacheKey, result);
          return result;
        }
      }
    }

    // 3. Provider 2: KuGou Lyrics Fallback
    try {
      const kgLrc = await this.fetchKuGouLyrics(cleanArtist, cleanTitle, duration);
      if (kgLrc) {
        const parsed = this.parseLrc(kgLrc);
        if (parsed.length >= 4) {
          const result = { lines: parsed, synced: true };
          this.setCache(cacheKey, result);
          return result;
        }
      }
    } catch (e) {
      console.debug('[LyricsService] KuGou lyrics fetch notice:', e);
    }

    // 4. Provider 3: LRCMux Fallback (from GooseOb/music_plr)
    try {
      const lrcMuxRes = await this.fetchLrcMux(cleanArtist, cleanTitle, duration);
      if (lrcMuxRes?.syncedLyrics) {
        const parsed = this.parseLrc(lrcMuxRes.syncedLyrics);
        if (parsed.length >= 4) {
          const result = { lines: parsed, synced: true };
          this.setCache(cacheKey, result);
          return result;
        }
      }
      if (lrcMuxRes?.plainLyrics) {
        const parsed = this.parsePlainLyrics(lrcMuxRes.plainLyrics, duration || 180);
        if (parsed.length > 0) {
          const result = { lines: parsed, synced: false };
          this.setCache(cacheKey, result);
          return result;
        }
      }
    } catch (e) {
      console.debug('[LyricsService] LRCMux fetch notice:', e);
    }

    // 5. Provider 4: Lyrics.ovh Plain-Text Fallback (from GooseOb/music_plr)
    try {
      const ovhPlain = await this.fetchLyricsOvh(cleanArtist, cleanTitle);
      if (ovhPlain) {
        const parsed = this.parsePlainLyrics(ovhPlain, duration || 180);
        if (parsed.length > 0) {
          const result = { lines: parsed, synced: false };
          this.setCache(cacheKey, result);
          return result;
        }
      }
    } catch (e) {
      console.debug('[LyricsService] Lyrics.ovh fetch notice:', e);
    }

    this.setCache(cacheKey, null);
    return null;
  }

  private static async fetchKuGouLyrics(
    artist: string,
    title: string,
    duration?: number,
  ): Promise<string | null> {
    try {
      const q = `${artist} ${title}`.trim();
      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      };
      const searchUrl = `https://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(q)}&page=1&pagesize=5&showtype=1`;
      const res = await desktopFetch(searchUrl, { headers, signal: AbortSignal.timeout(3500) });
      if (!res.ok) return null;
      const data = await res.json();
      const list = data?.data?.info || [];
      if (!list || list.length === 0) return null;

      const normTargetArtist = artist
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]/gi, ' ')
        .trim();
      const normTargetTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]/gi, ' ')
        .trim();

      for (const item of list) {
        const candSinger = (item.singername || '')
          .toLowerCase()
          .replace(/[^a-z0-9а-яё]/gi, ' ')
          .trim();
        const candSong = (item.songname || '')
          .toLowerCase()
          .replace(/[^a-z0-9а-яё]/gi, ' ')
          .trim();

        const titleMatches = getLyricsTitleMatchScore(candSong, normTargetTitle) > 0;
        const artistMatches =
          candSinger.includes(normTargetArtist) || normTargetArtist.includes(candSinger);

        if (!titleMatches || !artistMatches) continue;

        const rawDur = Number(item.duration);
        const hasValidDur = !isNaN(rawDur) && rawDur > 0;
        const durDiff = duration && duration > 0 && hasValidDur ? Math.abs(rawDur - duration) : 0;
        if (hasValidDur && duration && duration > 0 && durDiff > 15) continue;

        const durationMs = hasValidDur
          ? Math.round(rawDur * 1000)
          : duration && duration > 0
            ? Math.round(duration * 1000)
            : 0;

        const lyricUrl = `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(item.songname)}&duration=${durationMs}&hash=${encodeURIComponent(item.hash || '')}`;
        const lRes = await desktopFetch(lyricUrl, { headers, signal: AbortSignal.timeout(3500) });
        if (!lRes.ok) continue;
        const lData = await lRes.json();
        const cand = lData?.candidates?.[0];
        if (cand?.id && cand?.accesskey) {
          const dlUrl = `https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(cand.id)}&accesskey=${encodeURIComponent(cand.accesskey)}&fmt=lrc&charset=utf8`;
          const dlRes = await desktopFetch(dlUrl, { headers, signal: AbortSignal.timeout(3500) });
          if (!dlRes.ok) continue;
          const dlData = await dlRes.json();
          if (dlData?.content) {
            return Buffer.from(dlData.content, 'base64').toString('utf8');
          }
        }
      }
      return null;
    } catch (e) {
      console.debug('[LyricsService] KuGou lyrics error:', e);
      return null;
    }
  }

  private static async fetchLrcMux(
    artist: string,
    title: string,
    duration?: number,
  ): Promise<{ syncedLyrics?: string; plainLyrics?: string } | null> {
    try {
      const durParam = duration && duration > 0 ? `&duration=${Math.round(duration)}` : '';
      const url = `https://lrcmux.dev/api/get?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}${durParam}`;
      const res = await this.fetchJson(url, 4000);
      if (res?.syncedLyrics || res?.plainLyrics) {
        return {
          syncedLyrics: res.syncedLyrics,
          plainLyrics: res.plainLyrics,
        };
      }
    } catch (e) {
      console.debug('[LyricsService] LRCMux error:', e);
    }
    return null;
  }

  private static async fetchLyricsOvh(artist: string, title: string): Promise<string | null> {
    try {
      const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
      const res = await this.fetchJson(url, 4000);
      if (res?.lyrics && typeof res.lyrics === 'string') {
        const trimmed = res.lyrics.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
    } catch (e) {
      console.debug('[LyricsService] Lyrics.ovh error:', e);
    }
    return null;
  }
}
