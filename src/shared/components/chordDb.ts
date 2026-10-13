export interface ChordFretboard {
  chord: string;
  frets: number[]; // 6 strings from low E (string 6) to high E (string 1). -1 = X (muted), 0 = O (open), 1..N = fret number
  baseFret: number; // 1-based start fret of the 4-fret diagram
  barre?: { fret: number; fromString: number; toString: number }; // 1-based string index (1=high E, 6=low E)
}

export const CHORD_DEFINITIONS: Record<
  string,
  {
    frets: number[];
    baseFret?: number;
    barre?: { fret: number; fromString: number; toString: number };
  }
> = {
  // ==================== A ====================
  A: { frets: [-1, 0, 2, 2, 2, 0], baseFret: 1 },
  Am: { frets: [-1, 0, 2, 2, 1, 0], baseFret: 1 },
  A7: { frets: [-1, 0, 2, 0, 2, 0], baseFret: 1 },
  Am7: { frets: [-1, 0, 2, 0, 1, 0], baseFret: 1 },
  Amaj7: { frets: [-1, 0, 2, 1, 2, 0], baseFret: 1 },
  Asus2: { frets: [-1, 0, 2, 2, 0, 0], baseFret: 1 },
  Asus4: { frets: [-1, 0, 2, 2, 3, 0], baseFret: 1 },
  Aadd9: { frets: [-1, 0, 2, 4, 2, 0], baseFret: 1 },
  A6: { frets: [-1, 0, 2, 2, 2, 2], baseFret: 1 },
  Am6: { frets: [-1, 0, 2, 2, 1, 2], baseFret: 1 },
  A5: { frets: [-1, 0, 2, 2, -1, -1], baseFret: 1 },
  Adim: { frets: [-1, 0, 1, 2, 1, -1], baseFret: 1 },
  Aaug: { frets: [-1, 0, 3, 2, 2, 1], baseFret: 1 },

  // ==================== A# / Bb ====================
  'A#': { frets: [-1, 1, 3, 3, 3, 1], baseFret: 1, barre: { fret: 1, fromString: 5, toString: 1 } },
  'A#m': {
    frets: [-1, 1, 3, 3, 2, 1],
    baseFret: 1,
    barre: { fret: 1, fromString: 5, toString: 1 },
  },
  'A#7': {
    frets: [-1, 1, 3, 1, 3, 1],
    baseFret: 1,
    barre: { fret: 1, fromString: 5, toString: 1 },
  },
  Bb: { frets: [-1, 1, 3, 3, 3, 1], baseFret: 1, barre: { fret: 1, fromString: 5, toString: 1 } },
  Bbm: { frets: [-1, 1, 3, 3, 2, 1], baseFret: 1, barre: { fret: 1, fromString: 5, toString: 1 } },
  Bb7: { frets: [-1, 1, 3, 1, 3, 1], baseFret: 1, barre: { fret: 1, fromString: 5, toString: 1 } },
  Bbmaj7: {
    frets: [-1, 1, 3, 2, 3, 1],
    baseFret: 1,
    barre: { fret: 1, fromString: 5, toString: 1 },
  },
  Bbsus2: {
    frets: [-1, 1, 3, 3, 1, 1],
    baseFret: 1,
    barre: { fret: 1, fromString: 5, toString: 1 },
  },
  Bbsus4: {
    frets: [-1, 1, 3, 3, 4, 1],
    baseFret: 1,
    barre: { fret: 1, fromString: 5, toString: 1 },
  },
  Bb5: { frets: [-1, 1, 3, 3, -1, -1], baseFret: 1 },

  // ==================== B / H ====================
  B: { frets: [-1, 2, 4, 4, 4, 2], baseFret: 2, barre: { fret: 2, fromString: 5, toString: 1 } },
  Bm: { frets: [-1, 2, 4, 4, 3, 2], baseFret: 2, barre: { fret: 2, fromString: 5, toString: 1 } },
  B7: { frets: [-1, 2, 1, 2, 0, 2], baseFret: 1 },
  Bm7: { frets: [-1, 2, 0, 2, 0, 2], baseFret: 1 },
  Bmaj7: {
    frets: [-1, 2, 4, 3, 4, 2],
    baseFret: 2,
    barre: { fret: 2, fromString: 5, toString: 1 },
  },
  Bsus2: {
    frets: [-1, 2, 4, 4, 2, 2],
    baseFret: 2,
    barre: { fret: 2, fromString: 5, toString: 1 },
  },
  Bsus4: {
    frets: [-1, 2, 4, 4, 5, 2],
    baseFret: 2,
    barre: { fret: 2, fromString: 5, toString: 1 },
  },
  B5: { frets: [-1, 2, 4, 4, -1, -1], baseFret: 2 },
  // H aliases
  H: { frets: [-1, 2, 4, 4, 4, 2], baseFret: 2, barre: { fret: 2, fromString: 5, toString: 1 } },
  Hm: { frets: [-1, 2, 4, 4, 3, 2], baseFret: 2, barre: { fret: 2, fromString: 5, toString: 1 } },
  H7: { frets: [-1, 2, 1, 2, 0, 2], baseFret: 1 },
  Hm7: { frets: [-1, 2, 0, 2, 0, 2], baseFret: 1 },
  Hmaj7: {
    frets: [-1, 2, 4, 3, 4, 2],
    baseFret: 2,
    barre: { fret: 2, fromString: 5, toString: 1 },
  },
  Hsus2: {
    frets: [-1, 2, 4, 4, 2, 2],
    baseFret: 2,
    barre: { fret: 2, fromString: 5, toString: 1 },
  },
  Hsus4: {
    frets: [-1, 2, 4, 4, 5, 2],
    baseFret: 2,
    barre: { fret: 2, fromString: 5, toString: 1 },
  },
  H5: { frets: [-1, 2, 4, 4, -1, -1], baseFret: 2 },

  // ==================== C ====================
  C: { frets: [-1, 3, 2, 0, 1, 0], baseFret: 1 },
  Cm: { frets: [-1, 3, 5, 5, 4, 3], baseFret: 3, barre: { fret: 3, fromString: 5, toString: 1 } },
  C7: { frets: [-1, 3, 2, 3, 1, 0], baseFret: 1 },
  Cm7: { frets: [-1, 3, 5, 3, 4, 3], baseFret: 3, barre: { fret: 3, fromString: 5, toString: 1 } },
  Cmaj7: { frets: [-1, 3, 2, 0, 0, 0], baseFret: 1 },
  Cadd9: { frets: [-1, 3, 2, 0, 3, 3], baseFret: 1 },
  Csus2: { frets: [-1, 3, 0, 0, 1, 3], baseFret: 1 },
  Csus4: { frets: [-1, 3, 3, 0, 1, 1], baseFret: 1 },
  C6: { frets: [-1, 3, 2, 2, 1, 0], baseFret: 1 },
  C5: { frets: [-1, 3, 5, 5, -1, -1], baseFret: 3 },
  Cdim: { frets: [-1, -1, 1, 2, 1, 2], baseFret: 1 },

  // ==================== C# / Db ====================
  'C#': { frets: [-1, 4, 6, 6, 6, 4], baseFret: 4, barre: { fret: 4, fromString: 5, toString: 1 } },
  'C#m': {
    frets: [-1, 4, 6, 6, 5, 4],
    baseFret: 4,
    barre: { fret: 4, fromString: 5, toString: 1 },
  },
  'C#7': {
    frets: [-1, 4, 6, 4, 6, 4],
    baseFret: 4,
    barre: { fret: 4, fromString: 5, toString: 1 },
  },
  'C#m7': {
    frets: [-1, 4, 6, 4, 5, 4],
    baseFret: 4,
    barre: { fret: 4, fromString: 5, toString: 1 },
  },
  'C#maj7': {
    frets: [-1, 4, 6, 5, 6, 4],
    baseFret: 4,
    barre: { fret: 4, fromString: 5, toString: 1 },
  },
  'C#sus4': {
    frets: [-1, 4, 6, 6, 7, 4],
    baseFret: 4,
    barre: { fret: 4, fromString: 5, toString: 1 },
  },
  'C#5': { frets: [-1, 4, 6, 6, -1, -1], baseFret: 4 },
  Db: { frets: [-1, 4, 6, 6, 6, 4], baseFret: 4, barre: { fret: 4, fromString: 5, toString: 1 } },
  Dbm: { frets: [-1, 4, 6, 6, 5, 4], baseFret: 4, barre: { fret: 4, fromString: 5, toString: 1 } },
  Db7: { frets: [-1, 4, 6, 4, 6, 4], baseFret: 4, barre: { fret: 4, fromString: 5, toString: 1 } },

  // ==================== D ====================
  D: { frets: [-1, -1, 0, 2, 3, 2], baseFret: 1 },
  Dm: { frets: [-1, -1, 0, 2, 3, 1], baseFret: 1 },
  D7: { frets: [-1, -1, 0, 2, 1, 2], baseFret: 1 },
  Dm7: { frets: [-1, -1, 0, 2, 1, 1], baseFret: 1 },
  Dmaj7: { frets: [-1, -1, 0, 2, 2, 2], baseFret: 1 },
  Dsus2: { frets: [-1, -1, 0, 2, 3, 0], baseFret: 1 },
  Dsus4: { frets: [-1, -1, 0, 2, 3, 3], baseFret: 1 },
  Dadd9: { frets: [-1, -1, 0, 2, 5, 2], baseFret: 1 },
  D6: { frets: [-1, -1, 0, 2, 0, 2], baseFret: 1 },
  Dm6: { frets: [-1, -1, 0, 2, 0, 1], baseFret: 1 },
  D5: { frets: [-1, -1, 0, 2, 3, -1], baseFret: 1 },

  // ==================== D# / Eb ====================
  'D#': { frets: [-1, 6, 8, 8, 8, 6], baseFret: 6, barre: { fret: 6, fromString: 5, toString: 1 } },
  'D#m': {
    frets: [-1, 6, 8, 8, 7, 6],
    baseFret: 6,
    barre: { fret: 6, fromString: 5, toString: 1 },
  },
  'D#7': {
    frets: [-1, 6, 8, 6, 8, 6],
    baseFret: 6,
    barre: { fret: 6, fromString: 5, toString: 1 },
  },
  'D#m7': {
    frets: [-1, 6, 8, 6, 7, 6],
    baseFret: 6,
    barre: { fret: 6, fromString: 5, toString: 1 },
  },
  'D#5': { frets: [-1, 6, 8, 8, -1, -1], baseFret: 6 },
  Eb: { frets: [-1, 6, 8, 8, 8, 6], baseFret: 6, barre: { fret: 6, fromString: 5, toString: 1 } },
  Ebm: { frets: [-1, 6, 8, 8, 7, 6], baseFret: 6, barre: { fret: 6, fromString: 5, toString: 1 } },
  Eb7: { frets: [-1, 6, 8, 6, 8, 6], baseFret: 6, barre: { fret: 6, fromString: 5, toString: 1 } },
  Ebmaj7: {
    frets: [-1, 6, 8, 7, 8, 6],
    baseFret: 6,
    barre: { fret: 6, fromString: 5, toString: 1 },
  },

  // ==================== E ====================
  E: { frets: [0, 2, 2, 1, 0, 0], baseFret: 1 },
  Em: { frets: [0, 2, 2, 0, 0, 0], baseFret: 1 },
  E7: { frets: [0, 2, 0, 1, 0, 0], baseFret: 1 },
  Em7: { frets: [0, 2, 0, 0, 0, 0], baseFret: 1 },
  Emaj7: { frets: [0, 2, 1, 1, 0, 0], baseFret: 1 },
  Esus4: { frets: [0, 2, 2, 2, 0, 0], baseFret: 1 },
  Eadd9: { frets: [0, 2, 2, 1, 0, 2], baseFret: 1 },
  E6: { frets: [0, 2, 2, 1, 2, 0], baseFret: 1 },
  Em6: { frets: [0, 2, 2, 0, 2, 0], baseFret: 1 },
  E5: { frets: [0, 2, 2, -1, -1, -1], baseFret: 1 },

  // ==================== F ====================
  F: { frets: [1, 3, 3, 2, 1, 1], baseFret: 1, barre: { fret: 1, fromString: 6, toString: 1 } },
  Fm: { frets: [1, 3, 3, 1, 1, 1], baseFret: 1, barre: { fret: 1, fromString: 6, toString: 1 } },
  F7: { frets: [1, 3, 1, 2, 1, 1], baseFret: 1, barre: { fret: 1, fromString: 6, toString: 1 } },
  Fm7: { frets: [1, 3, 1, 1, 1, 1], baseFret: 1, barre: { fret: 1, fromString: 6, toString: 1 } },
  Fmaj7: { frets: [-1, -1, 3, 2, 1, 0], baseFret: 1 },
  Fsus2: { frets: [-1, -1, 3, 0, 1, 1], baseFret: 1 },
  Fsus4: { frets: [1, 3, 3, 3, 1, 1], baseFret: 1, barre: { fret: 1, fromString: 6, toString: 1 } },
  Fadd9: { frets: [1, 3, 3, 2, 1, 3], baseFret: 1, barre: { fret: 1, fromString: 6, toString: 1 } },
  F5: { frets: [1, 3, 3, -1, -1, -1], baseFret: 1 },

  // ==================== F# / Gb ====================
  'F#': { frets: [2, 4, 4, 3, 2, 2], baseFret: 2, barre: { fret: 2, fromString: 6, toString: 1 } },
  'F#m': { frets: [2, 4, 4, 2, 2, 2], baseFret: 2, barre: { fret: 2, fromString: 6, toString: 1 } },
  'F#7': { frets: [2, 4, 2, 3, 2, 2], baseFret: 2, barre: { fret: 2, fromString: 6, toString: 1 } },
  'F#m7': {
    frets: [2, 4, 2, 2, 2, 2],
    baseFret: 2,
    barre: { fret: 2, fromString: 6, toString: 1 },
  },
  'F#maj7': {
    frets: [2, 4, 3, 3, 2, 2],
    baseFret: 2,
    barre: { fret: 2, fromString: 6, toString: 1 },
  },
  'F#sus4': {
    frets: [2, 4, 4, 4, 2, 2],
    baseFret: 2,
    barre: { fret: 2, fromString: 6, toString: 1 },
  },
  'F#5': { frets: [2, 4, 4, -1, -1, -1], baseFret: 2 },
  Gb: { frets: [2, 4, 4, 3, 2, 2], baseFret: 2, barre: { fret: 2, fromString: 6, toString: 1 } },
  Gbm: { frets: [2, 4, 4, 2, 2, 2], baseFret: 2, barre: { fret: 2, fromString: 6, toString: 1 } },
  Gb7: { frets: [2, 4, 2, 3, 2, 2], baseFret: 2, barre: { fret: 2, fromString: 6, toString: 1 } },

  // ==================== G ====================
  G: { frets: [3, 2, 0, 0, 0, 3], baseFret: 1 },
  Gm: { frets: [3, 5, 5, 3, 3, 3], baseFret: 3, barre: { fret: 3, fromString: 6, toString: 1 } },
  G7: { frets: [3, 2, 0, 0, 0, 1], baseFret: 1 },
  Gm7: { frets: [3, 5, 3, 3, 3, 3], baseFret: 3, barre: { fret: 3, fromString: 6, toString: 1 } },
  Gmaj7: { frets: [3, 2, 0, 0, 0, 2], baseFret: 1 },
  Gsus2: { frets: [3, 0, 0, 0, 3, 3], baseFret: 1 },
  Gsus4: { frets: [3, 3, 0, 0, 1, 3], baseFret: 1 },
  Gadd9: { frets: [3, 2, 0, 2, 0, 3], baseFret: 1 },
  G6: { frets: [3, 2, 0, 0, 0, 0], baseFret: 1 },
  G5: { frets: [3, 5, 5, -1, -1, -1], baseFret: 3 },

  // ==================== G# / Ab ====================
  'G#': { frets: [4, 6, 6, 5, 4, 4], baseFret: 4, barre: { fret: 4, fromString: 6, toString: 1 } },
  'G#m': { frets: [4, 6, 6, 4, 4, 4], baseFret: 4, barre: { fret: 4, fromString: 6, toString: 1 } },
  'G#7': { frets: [4, 6, 4, 5, 4, 4], baseFret: 4, barre: { fret: 4, fromString: 6, toString: 1 } },
  'G#m7': {
    frets: [4, 6, 4, 4, 4, 4],
    baseFret: 4,
    barre: { fret: 4, fromString: 6, toString: 1 },
  },
  'G#5': { frets: [4, 6, 6, -1, -1, -1], baseFret: 4 },
  Ab: { frets: [4, 6, 6, 5, 4, 4], baseFret: 4, barre: { fret: 4, fromString: 6, toString: 1 } },
  Abm: { frets: [4, 6, 6, 4, 4, 4], baseFret: 4, barre: { fret: 4, fromString: 6, toString: 1 } },
  Ab7: { frets: [4, 6, 4, 5, 4, 4], baseFret: 4, barre: { fret: 4, fromString: 6, toString: 1 } },
};

/**
 * Normalizes chord name and returns fretboard diagram data.
 * If exact chord is not found, tries aliases and base variations.
 */
export function getChordDiagram(chordName: string): ChordFretboard | null {
  if (!chordName) return null;

  // Clean and normalize (e.g. "am" -> "Am", "h7" -> "H7", "C#m7" -> "C#m7")
  let clean = chordName.trim().replace(/\s+/g, '');
  if (!clean) return null;

  // Capitalize root note
  if (/^[a-g]/i.test(clean)) {
    clean = clean[0].toUpperCase() + clean.slice(1);
  }

  // 1. Direct lookup
  if (CHORD_DEFINITIONS[clean]) {
    const def = CHORD_DEFINITIONS[clean];
    return {
      chord: clean,
      frets: def.frets,
      baseFret: def.baseFret || 1,
      barre: def.barre,
    };
  }

  // 2. Cyrillic H / B alias
  let alias = clean;
  if (alias.startsWith('H')) alias = 'B' + alias.slice(1);
  else if (alias.startsWith('B') && !alias.startsWith('Bb')) alias = 'H' + alias.slice(1);

  if (CHORD_DEFINITIONS[alias]) {
    const def = CHORD_DEFINITIONS[alias];
    return {
      chord: clean,
      frets: def.frets,
      baseFret: def.baseFret || 1,
      barre: def.barre,
    };
  }

  // 3. Remove slash chord bass note (e.g. D/F# -> D, G/B -> G, Am/C -> Am)
  if (clean.includes('/')) {
    const root = clean.split('/')[0];
    const rootDiag = getChordDiagram(root);
    if (rootDiag) {
      return {
        ...rootDiag,
        chord: clean,
      };
    }
  }

  // 4. Fallback: strip complex extensions (e.g. "F#m7" -> "F#m", "Cadd9" -> "C", "Asus4" -> "A")
  const stripped = clean.replace(/(?:add9|sus2|sus4|maj7|m7|7|6|9|5|dim|aug)$/, '');

  if (stripped && stripped !== clean) {
    const fallbackDiag = getChordDiagram(stripped);
    if (fallbackDiag) {
      return {
        ...fallbackDiag,
        chord: clean,
      };
    }
  }

  return null;
}

/**
 * Normalizes English section headers (Versus, Pre-chorus, Outro, etc.) to clean Russian labels
 */
export function formatSectionHeader(headerText: string): string {
  const clean = headerText.replace(/[\[\]]/g, '').trim();

  // Match pattern like "Verse 1", "Куплет 2", "Chorus", "Pre-Chorus", "Outro"
  const vMatch = clean.match(/^(?:verse|versus|куплет)\s*(\d*)$/i);
  if (vMatch) {
    return vMatch[1] ? `Куплет ${vMatch[1]}` : 'Куплет';
  }

  const cMatch = clean.match(/^(?:chorus|припев)\s*(\d*)$/i);
  if (cMatch) {
    return cMatch[1] ? `Припев ${cMatch[1]}` : 'Припев';
  }

  if (/^(?:pre-chorus|prechorus|предприпев)/i.test(clean)) return 'Предприпев';
  if (/^(?:intro|вступление|интро)/i.test(clean)) return 'Вступление';
  if (/^(?:outro|аутро|концовка|кода)/i.test(clean)) return 'Кода (Аутро)';
  if (/^(?:bridge|бридж)/i.test(clean)) return 'Бридж';
  if (/^(?:solo|гитарное соло|соло)/i.test(clean)) return 'Соло';
  if (/^(?:interlude|проигрыш)/i.test(clean)) return 'Проигрыш';
  if (/^(?:hook|хук)/i.test(clean)) return 'Хук';

  return clean;
}
