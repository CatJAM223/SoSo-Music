const SCALE_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALE_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function transposeNote(note: string, semitones: number): string {
  let idx = SCALE_SHARP.indexOf(note);
  let useFlats = false;
  if (idx === -1) {
    idx = SCALE_FLAT.indexOf(note);
    useFlats = true;
  }
  if (idx === -1) return note;
  const newIdx = (idx + semitones + 120) % 12;
  return useFlats ? SCALE_FLAT[newIdx] : SCALE_SHARP[newIdx];
}

export function transposeChordsInText(content: string, semitones: number): string {
  if (semitones === 0 || !content) return content;
  return content.replace(/\[ch\]([^\[]+)\[\/ch\]/g, (_m, chord) => {
    const transposed = chord.replace(/([A-G][#b]?)/g, (n: string) => transposeNote(n, semitones));
    return `[ch]${transposed}[/ch]`;
  });
}
