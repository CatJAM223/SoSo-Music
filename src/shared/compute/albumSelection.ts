import { requireRustCompute } from './rustCore.ts';

/** Text features only; edition compatibility and priority are owned by Rust. */
export function albumMatchScore(wanted: string, actual: string): number {
  const normalize = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
  const edition = (value: string) =>
    Number(/\b(deluxe|expanded)\b/i.test(value)) |
    (Number(/\bremaster(?:ed)?\b/i.test(value)) << 1) |
    (Number(/\blive\b|концерт/i.test(value)) << 2) |
    (Number(/\banniversary\b|юбилей/i.test(value)) << 3);
  const left = normalize(wanted),
    right = normalize(actual);
  return requireRustCompute().album_match_score(
    Number(!!left && !!right),
    Number(left === right),
    Number(left.includes(right) || right.includes(left)),
    edition(wanted),
    edition(actual),
  );
}
