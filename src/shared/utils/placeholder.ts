/**
 * Local offline SVG placeholders for album artwork and artist avatars.
 * Eliminates third-party network dependencies (like Unsplash) for broken or missing images.
 */

// Elegant vinyl disc SVG encoded as an inline Data URI
const VINYL_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1f1f23" />
      <stop offset="50%" stop-color="#141416" />
      <stop offset="100%" stop-color="#09090b" />
    </linearGradient>
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#18c95f" />
      <stop offset="100%" stop-color="#10b981" />
    </linearGradient>
    <radialGradient id="groove" cx="50%" cy="50%" r="50%">
      <stop offset="60%" stop-color="#18181b" stop-opacity="0.3" />
      <stop offset="100%" stop-color="#09090b" stop-opacity="0.9" />
    </radialGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg)" />
  <!-- Vinyl disk body -->
  <circle cx="200" cy="200" r="160" fill="#121214" stroke="#27272a" stroke-width="2" />
  <circle cx="200" cy="200" r="160" fill="url(#groove)" />
  <!-- Grooves -->
  <circle cx="200" cy="200" r="140" fill="none" stroke="#27272a" stroke-width="1" stroke-dasharray="8 6" opacity="0.4" />
  <circle cx="200" cy="200" r="120" fill="none" stroke="#27272a" stroke-width="1" opacity="0.3" />
  <circle cx="200" cy="200" r="100" fill="none" stroke="#27272a" stroke-width="1" stroke-dasharray="12 8" opacity="0.4" />
  <circle cx="200" cy="200" r="80" fill="none" stroke="#27272a" stroke-width="1" opacity="0.3" />
  <!-- Center label -->
  <circle cx="200" cy="200" r="58" fill="#18181b" stroke="url(#brandGrad)" stroke-width="2.5" />
  <!-- Musical note in center -->
  <path d="M195 180 v30 a12 12 0 1 1 -8 -11.5 v-24.5 l22 -5 v24 a12 12 0 1 1 -8 -11.5 v-17 z" fill="#18c95f" opacity="0.95" />
  <!-- Spindle hole -->
  <circle cx="200" cy="200" r="7" fill="#09090b" stroke="#3f3f46" stroke-width="1.5" />
</svg>
`
  .trim()
  .replace(/\n\s*/g, '');

export const DEFAULT_COVER_SVG_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(VINYL_SVG)}`;

/**
 * Generates an SVG avatar placeholder with artist/album initials
 */
export function generateInitialsAvatarUri(name: string = 'SoSo'): string {
  const cleanName = name.trim();
  const initials = cleanName
    ? cleanName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('')
    : '♫';

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="100%" height="100%">
  <defs>
    <linearGradient id="initBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#27272a" />
      <stop offset="100%" stop-color="#18181b" />
    </linearGradient>
  </defs>
  <rect width="200" height="200" fill="url(#initBg)" />
  <circle cx="100" cy="100" r="86" fill="none" stroke="#3f3f46" stroke-width="2" opacity="0.5" />
  <text x="100" y="112" font-family="Roboto, system-ui, sans-serif" font-size="44" font-weight="800" fill="#18c95f" text-anchor="middle" dominant-baseline="middle" letter-spacing="1">${initials}</text>
</svg>
  `
    .trim()
    .replace(/\n\s*/g, '');

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
