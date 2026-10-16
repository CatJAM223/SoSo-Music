/** Retry-After accepts delay-seconds or an HTTP date; invalid values use caller policy. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isSafeInteger(seconds) && Number.isSafeInteger(seconds * 1000)
      ? seconds * 1000
      : null;
  }
  // HTTP-date permits IMF-fixdate and the two obsolete wire formats, not
  // arbitrary locale/ISO dates that Date.parse also happens to understand.
  const day = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
  const month = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  const time = '[0-9]{2}:[0-9]{2}:[0-9]{2}';
  const formats = [
    new RegExp('^' + day + ', [0-9]{2} ' + month + ' [0-9]{4} ' + time + ' GMT$', 'i'),
    new RegExp(
      '^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [0-9]{2}-' +
        month +
        '-[0-9]{2} ' +
        time +
        ' GMT$',
      'i',
    ),
    new RegExp('^' + day + ' ' + month + ' (?: [0-9]|[0-9]{2}) ' + time + ' [0-9]{4}$', 'i'),
  ];
  if (!formats.some((format) => format.test(text))) return null;
  const date = Date.parse(formats[2].test(text) ? text + ' GMT' : text);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, milliseconds));
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
