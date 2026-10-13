export type PlaybackLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
const SECRET_FIELD =
  /^(?:authorization|cookie|setcookie|password|passwd|clientsecret|accesstoken|refreshtoken|idtoken|sapisidhash|sapisid|visitordata|potoken|signature|sig|token)$/i;
const LIMIT = 2000;

/** Keep diagnostic IDs/timings while removing credentials and expiring stream URLs. */
export function sanitizePlaybackText(value: string): string {
  return value
    .slice(0, LIMIT)
    .replace(/\bhttps?:\/\/[^\s<>"')\]]+/gi, (raw) => {
      try {
        const url = new URL(raw);
        const itag = url.searchParams.get('itag');
        return (
          url.origin +
          url.pathname +
          (url.search || url.hash || url.username || url.password
            ? '?[redacted]' + (itag && /^\d{1,5}$/.test(itag) ? '&itag=' + itag : '')
            : '')
        );
      } catch {
        return '[redacted-url]';
      }
    })
    .replace(
      /\b(?:authorization|cookie|set-cookie)["']?\s*[:=]\s*[^\r\n|]*/gi,
      '[redacted-credentials]',
    )
    .replace(
      /\b(?:access_token|refresh_token|client_secret|po_token|token|signature|password|sapisid(?:hash)?)["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;|]+)/gi,
      '[redacted-credential]',
    )
    .replace(/[\r\n\u0000-\u001f]+/g, ' ');
}

export function preparePlaybackLog(
  level: unknown,
  message: unknown,
  meta?: unknown,
): {
  level: PlaybackLogLevel;
  message: string;
  meta?: unknown;
  suffix: string;
} {
  const normalized = String(level || '').toUpperCase();
  const safeLevel: PlaybackLogLevel = ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(normalized)
    ? (normalized as PlaybackLogLevel)
    : 'INFO';
  const seen = new WeakSet<object>();
  let remaining = 100;
  const clean = (value: unknown, depth = 0): unknown => {
    if (--remaining < 0) return '[truncated]';
    if (typeof value === 'string') return sanitizePlaybackText(value);
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'boolean' || value == null) return value;
    if (typeof value === 'bigint') return String(value);
    if (typeof value !== 'object') return '[' + typeof value + ']';
    if (seen.has(value)) return '[circular]';
    if (depth >= 4) return '[truncated]';
    seen.add(value);
    if (value instanceof Error)
      return {
        name: sanitizePlaybackText(value.name),
        message: sanitizePlaybackText(value.message),
        stack: sanitizePlaybackText(value.stack || ''),
      };
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => clean(item, depth + 1));
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).slice(0, 20)) {
      const safeKey = sanitizePlaybackText(key).slice(0, 100);
      try {
        result[safeKey] = SECRET_FIELD.test(key.replace(/[^a-z]/gi, ''))
          ? '[redacted]'
          : clean((value as Record<string, unknown>)[key], depth + 1);
      } catch {
        result[safeKey] = '[unreadable]';
      }
    }
    return result;
  };
  let safeMeta: unknown;
  let suffix = '';
  if (meta !== undefined && meta !== null) {
    try {
      safeMeta = clean(meta);
      const serialized = typeof safeMeta === 'string' ? safeMeta : JSON.stringify(safeMeta);
      if (serialized.length > 6000) safeMeta = '[truncated metadata]';
      suffix = ' | ' + (typeof safeMeta === 'string' ? safeMeta : JSON.stringify(safeMeta));
    } catch {
      safeMeta = '[unserializable metadata]';
      suffix = ' | ' + safeMeta;
    }
  }
  return {
    level: safeLevel,
    message: sanitizePlaybackText(String(message || '')),
    meta: safeMeta,
    suffix,
  };
}
