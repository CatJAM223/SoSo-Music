import type { LyricsLine } from '../types/index.ts';

export function cleanLyricText(rawText: string): string {
  if (!rawText) return '';
  return rawText
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/<[0-9:.]+>/g, '') // Strip enhanced LRC word timestamps
    .replace(/\([0-9:.]+\)/g, '') // Strip word timestamp parentheses
    .replace(/<[^>]+>/g, '') // Strip any remaining HTML tags (e.g. from KuGou responses)
    .replace(/\{[^}]+\}/g, '') // Strip Musixmatch inline word-level annotations {word}
    .replace(/[\uFFFD\u0000\uFEFF]/g, '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface KaraokeLine {
  id: string;
  time: number;
  text: string;
  chords?: string;
  isInstrumentalBreak: boolean;
}

export function buildKaraokeLinesWithBreaks(
  lines: readonly (LyricsLine & { chords?: string })[],
): KaraokeLine[] {
  const list: KaraokeLine[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const previousLine = lineIndex > 0 ? lines[lineIndex - 1] : null;

    if (lineIndex === 0 && line.time > 7) {
      list.push({
        id: 'break-intro',
        time: 0,
        text: '• • •',
        isInstrumentalBreak: true,
      });
    } else if (previousLine && line.time - previousLine.time > 8) {
      list.push({
        id: `break-${previousLine.time}-${line.time}`,
        time: previousLine.time + 1.5,
        text: '• • •',
        isInstrumentalBreak: true,
      });
    }

    list.push({
      id: `lyric-${line.time}-${lineIndex}`,
      time: line.time,
      text: line.text,
      chords: line.chords,
      isInstrumentalBreak: false,
    });
  }
  return list;
}

function normalizeLyricsWords(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Intelligent fuzzy alignment algorithm matching LRC timestamps with chord tab lines
 */
export function alignLyricsWithChords(
  timedLines: LyricsLine[],
  chordTab: string,
): { time: number; text: string; chords: string }[] {
  if (!timedLines || timedLines.length === 0) return [];
  if (!chordTab || !chordTab.includes('[ch]')) {
    return timedLines.map((line) => ({ time: line.time, text: line.text, chords: '' }));
  }

  const rawLines = chordTab.split('\n');
  const chordPairs: { chordsLine: string; normalizedLyrics: string }[] = [];

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    const line = rawLines[lineIndex];
    if (line.includes('[ch]')) {
      const nextLine = rawLines[lineIndex + 1] || '';
      if (
        !nextLine.includes('[ch]') &&
        nextLine.trim().length > 0 &&
        !nextLine.trim().startsWith('[')
      ) {
        chordPairs.push({
          chordsLine: line,
          normalizedLyrics: normalizeLyricsWords(nextLine),
        });
        lineIndex++; // Paired line consumed
      } else {
        chordPairs.push({
          chordsLine: line,
          normalizedLyrics: '',
        });
      }
    }
  }

  return timedLines.map((line) => {
    const normalizedLine = normalizeLyricsWords(line.text);
    if (!normalizedLine) return { time: line.time, text: line.text, chords: '' };

    let bestPair: { chordsLine: string; normalizedLyrics: string } | null = null;
    let highestScore = 0;

    for (const pair of chordPairs) {
      if (pair.normalizedLyrics === normalizedLine) {
        bestPair = pair;
        break;
      }
      if (
        pair.normalizedLyrics.includes(normalizedLine) ||
        normalizedLine.includes(pair.normalizedLyrics)
      ) {
        const score =
          Math.min(pair.normalizedLyrics.length, normalizedLine.length) /
          Math.max(pair.normalizedLyrics.length, normalizedLine.length);
        if (score > highestScore && score >= 0.4) {
          highestScore = score;
          bestPair = pair;
        }
      }
    }

    return {
      time: line.time,
      text: line.text,
      chords: bestPair ? bestPair.chordsLine : '',
    };
  });
}
