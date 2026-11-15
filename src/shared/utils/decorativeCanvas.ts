const MAX_PIXELS = 1920 * 1080;

export function decorativeCanvasScale(width: number, height: number, maxDpr = 1) {
  return Math.min(
    window.devicePixelRatio || 1,
    maxDpr,
    Math.sqrt(MAX_PIXELS / Math.max(1, width * height)),
  );
}
