export interface YouTubeAccountCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
}

export function isYouTubeCookieDomain(domain: unknown): domain is string {
  if (typeof domain !== 'string') return false;
  const host = domain.toLowerCase().replace(/^\./, '');
  return host === 'youtube.com' || host.endsWith('.youtube.com');
}

export function buildYouTubeCookieHeader(
  cookies: { name: string; value: string; expirationDate?: number }[],
  now = Date.now() / 1000,
): string {
  const values = new Map<string, string>();
  for (const cookie of cookies) {
    if (!/^[A-Za-z0-9_-]+$/.test(cookie.name) || !cookie.value || /[;\r\n\0]/.test(cookie.value))
      continue;
    if (cookie.expirationDate && cookie.expirationDate <= now) continue;
    values.set(cookie.name, cookie.value);
  }
  // YouTube.js signs web requests with SAPISID; a secure account cookie can supply it.
  if (!values.has('SAPISID')) {
    const secureSid = values.get('__Secure-3PAPISID') || values.get('__Secure-1PAPISID');
    if (secureSid) values.set('SAPISID', secureSid);
  }
  if (
    !values.has('SAPISID') ||
    !['SID', '__Secure-3PSID', '__Secure-1PSID'].some((name) => values.has(name))
  )
    return '';
  return [...values].map(([name, value]) => name + '=' + value).join('; ');
}

/** Accept only a user-selected YouTube export. Other accounts/domains are never imported. */
export function parseYouTubeCookieFile(
  text: string,
  now = Date.now() / 1000,
): YouTubeAccountCookie[] {
  if (Buffer.byteLength(text, 'utf8') > 256 * 1024)
    throw new Error('Файл сессии слишком большой. Экспортируйте cookies только для YouTube.');
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  let rows: unknown[];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let json: any;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new Error('Не удалось прочитать JSON сессии YouTube.');
    }
    rows = Array.isArray(json) ? json : json.cookies;
    if (!Array.isArray(rows)) throw new Error('В файле нет списка cookies.');
  } else {
    rows = trimmed.split(/\r?\n/).flatMap((line) => {
      const httpOnly = line.startsWith('#HttpOnly_');
      if (httpOnly) line = line.slice('#HttpOnly_'.length);
      else if (!line || line.startsWith('#')) return [];
      const parts = line.split('\t');
      if (parts.length !== 7)
        throw new Error('Нужен экспорт cookies в формате Netscape (.txt) или JSON.');
      return [
        {
          domain: parts[0],
          path: parts[2],
          secure: parts[3] === 'TRUE',
          expirationDate: Number(parts[4]),
          name: parts[5],
          value: parts[6],
          httpOnly,
        },
      ];
    });
  }
  if (rows.length > 512)
    throw new Error('Слишком много cookies. Экспортируйте сессию только для YouTube.');
  const result: YouTubeAccountCookie[] = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (!isYouTubeCookieDomain(row.domain)) continue;
    if (
      typeof row.name !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(row.name) ||
      typeof row.value !== 'string' ||
      !row.value ||
      row.value.length > 8192 ||
      /[;\r\n\0]/.test(row.value)
    ) {
      throw new Error('В файле есть некорректные cookies YouTube.');
    }
    const expiry = row.expirationDate ?? row.expires;
    if (
      expiry !== undefined &&
      (typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry < 0)
    ) {
      throw new Error('Некорректный срок сессии YouTube.');
    }
    if (typeof expiry === 'number' && expiry > 0 && expiry <= now) continue;
    const cookiePath = typeof row.path === 'string' ? row.path : '/';
    if (!cookiePath.startsWith('/') || /[\r\n\0]/.test(cookiePath))
      throw new Error('Некорректный путь cookies YouTube.');
    result.push({
      name: row.name,
      value: row.value,
      domain: row.domain.toLowerCase(),
      path: cookiePath,
      secure: row.secure !== false,
      httpOnly: row.httpOnly === true,
      ...(typeof expiry === 'number' && expiry > 0 ? { expirationDate: expiry } : {}),
    });
  }
  if (
    !buildYouTubeCookieHeader(
      result.filter((cookie) => cookie.path === '/'),
      now,
    )
  ) {
    throw new Error(
      'В файле нет действующей авторизации YouTube. Войдите в YouTube и экспортируйте сессию заново.',
    );
  }
  return result;
}
