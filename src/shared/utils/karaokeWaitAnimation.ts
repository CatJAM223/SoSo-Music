type Point = readonly [number, number];
// Start point followed by five pairs of quadratic control/end points.
type Stroke = readonly Point[];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => {
  const t = clamp(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const numberWeight = 3.2;
const dotWeight = 6;
// Contract the stroke, curl its short visible segment, then draw the new digit.
// Overlapping phases keep the pen moving without scaling or fading the whole glyph.
const joinStart = 4.25;
const joinEnd = 3.8;
const lineMorphStart = 3.6;
const digitMorphDuration = 0.6;
const line: Stroke = Array.from({ length: 11 }, (_, i) => [10 + i * 5.6, 26]);

// A compact, fixed-size handwritten stroke. The top of 3 and 2 stays anchored;
// only the lower part unfolds, instead of stretching an entire glyph outline.
const digits: Record<1 | 2 | 3, Stroke> = {
  3: [
    [30, 17],
    [35, 13],
    [41, 14],
    [48, 16],
    [44, 23],
    [42, 26],
    [37, 26],
    [48, 27],
    [45, 33],
    [42, 40],
    [30, 35],
  ],
  2: [
    [30, 17],
    [35, 13],
    [41, 14],
    [48, 16],
    [44, 23],
    [40, 27],
    [35, 31],
    [30, 35],
    [30, 36],
    [40, 36],
    [46, 36],
  ],
  1: [
    [34, 18],
    [38, 15],
    [40, 14],
    [40, 18],
    [40, 22],
    [40, 26],
    [40, 29],
    [40, 33],
    [40, 36],
    [40, 36],
    [40, 36],
  ],
};
const coordinate = (point: Point) => point.map((n) => n.toFixed(2)).join(' ');
function morph(from: Stroke, to = from, progress = 0): string {
  const t = ease(progress);
  const points = from.map((point, i): Point => [
    lerp(point[0], to[i][0], t),
    lerp(point[1], to[i][1], t),
  ]);
  return (
    'M' +
    coordinate(points[0]) +
    [1, 3, 5, 7, 9]
      .map((i) => 'Q' + coordinate(points[i]) + ' ' + coordinate(points[i + 1]))
      .join('')
  );
}
function dotSegments(time: number, animated: boolean): [Point, Point][] {
  return [18, 38, 58].map((x, i) => {
    const phase = (((time / 1.25 - i * 0.16) % 1) + 1) % 1;
    const y = 26 - (animated ? 6 * Math.max(0, Math.sin(phase * Math.PI * 2)) ** 2 : 0);
    return [
      [x - 0.025, y],
      [x + 0.025, y],
    ];
  });
}
function dotsPath(time: number, animated: boolean, join = 0): string {
  const t = ease(join);
  return dotSegments(time, animated)
    .map(([start, end], i) => {
      const left = 10 + (i * 56) / 3,
        right = 10 + ((i + 1) * 56) / 3;
      return (
        'M' +
        coordinate([lerp(start[0], left, t), lerp(start[1], 26, t)]) +
        'L' +
        coordinate([lerp(end[0], right, t), lerp(end[1], 26, t)])
      );
    })
    .join('');
}

export type KaraokeWaitFrame = {
  phase: 'dots' | 'line' | 'countdown' | 'hidden';
  digit: 3 | 2 | 1 | null;
  paths: string[];
  strokeWidth: number;
  strokeDasharray?: string;
  strokeDashoffset?: number;
};

type StrokeWindow = readonly [number, number];
function tracedMorph(
  from: Stroke,
  to: Stroke,
  progress: number,
  collapse: StrokeWindow,
  arrival: StrokeWindow,
): Pick<KaraokeWaitFrame, 'paths' | 'strokeDasharray' | 'strokeDashoffset'> {
  const p = clamp(progress);
  if (p <= 0) return { paths: [morph(from)] };
  if (p >= 1) return { paths: [morph(to)] };
  const contract = ease(p / 0.42);
  const turn = ease((p - 0.28) / 0.44);
  const draw = ease((p - 0.58) / 0.42);
  const start = lerp(lerp(lerp(0, collapse[0], contract), arrival[0], turn), 0, draw);
  const end = lerp(lerp(lerp(1, collapse[1], contract), arrival[1], turn), 1, draw);
  // morph() eases its own input; pass raw progress so shape and pen use the same turn.
  return {
    paths: [morph(from, to, (p - 0.28) / 0.44)],
    strokeDasharray: (end - start).toFixed(4) + ' 2',
    strokeDashoffset: -Number(start.toFixed(4)),
  };
}

const inactive: KaraokeWaitFrame = {
  phase: 'dots',
  digit: null,
  paths: [dotsPath(0, false)],
  strokeWidth: dotWeight,
};
/** One SVG path follows the media clock; pause, buffering and seeks need no timers. */
export function getKaraokeWaitFrame(
  time: number,
  nextLineTime: number,
  active: boolean,
): KaraokeWaitFrame {
  if (!active || !Number.isFinite(time) || !Number.isFinite(nextLineTime)) return inactive;
  const remaining = nextLineTime - time;
  if (remaining <= 0) return { phase: 'hidden', digit: null, paths: [], strokeWidth: numberWeight };
  if (remaining > joinStart)
    return { phase: 'dots', digit: null, paths: [dotsPath(time, true)], strokeWidth: dotWeight };
  if (remaining > joinEnd) {
    const join = (joinStart - remaining) / (joinStart - joinEnd);
    return {
      phase: 'line',
      digit: null,
      paths: [dotsPath(time, true, join)],
      strokeWidth: lerp(dotWeight, numberWeight, ease(join)),
    };
  }
  if (remaining > lineMorphStart)
    return { phase: 'line', digit: null, paths: [morph(line)], strokeWidth: numberWeight };
  if (remaining > 3)
    return {
      phase: 'countdown',
      digit: 3,
      ...tracedMorph(
        line,
        digits[3],
        (lineMorphStart - remaining) / (lineMorphStart - 3),
        [0.42, 0.58],
        [0, 0.16],
      ),
      strokeWidth: numberWeight,
    };
  const digit = Math.min(3, Math.ceil(remaining)) as 3 | 2 | 1;
  const nextDigit = digit === 3 ? 2 : 1;
  const progress =
    digit > 1 ? (digit - 1 + digitMorphDuration - remaining) / digitMorphDuration : 0;
  return {
    phase: 'countdown',
    digit,
    ...tracedMorph(
      digits[digit],
      digits[nextDigit],
      progress,
      digit === 3 ? [0.65, 1] : [0.44, 0.52],
      digit === 3 ? [0, 0.35] : [0.46, 0.54],
    ),
    strokeWidth: numberWeight,
  };
}
