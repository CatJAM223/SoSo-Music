import { net, type Session } from 'electron';
import { Readable } from 'node:stream';

/** Electron fetch cancels manual redirects; preserve the redirect for caller-side host validation. */
export async function electronFetch(
  url: string,
  init: RequestInit = {},
  browser?: Session,
): Promise<Response> {
  if (init.redirect !== 'manual') return browser ? browser.fetch(url, init) : net.fetch(url, init);
  const input = new Request(url, init);
  input.signal.throwIfAborted();
  const body = input.body ? Buffer.from(await input.arrayBuffer()) : undefined;
  input.signal.throwIfAborted();
  return new Promise<Response>((resolve, reject) => {
    const request = net.request({
      url,
      method: input.method,
      session: browser,
      redirect: 'manual',
      credentials: input.credentials,
      cache: input.cache,
      origin: input.headers.get('origin') ?? undefined,
    });
    const abort = () => {
      reject(input.signal.reason);
      request.abort();
    };
    input.signal.addEventListener('abort', abort, { once: true });
    request.on('close', () => input.signal.removeEventListener('abort', abort));
    request.on('error', reject);
    request.on('redirect', (status, _method, location, responseHeaders) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(responseHeaders))
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      headers.set('location', location);
      resolve(new Response(null, { status, headers }));
      request.abort();
    });
    request.on('response', (response) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers))
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const stream =
        input.method === 'HEAD' || [204, 205, 304].includes(response.statusCode)
          ? null
          : (Readable.toWeb(response as unknown as Readable) as ReadableStream<Uint8Array>);
      resolve(
        new Response(stream, {
          status: response.statusCode,
          statusText: response.statusMessage,
          headers,
        }),
      );
    });
    for (const [key, value] of input.headers) request.setHeader(key, value);
    if (body) request.write(body);
    request.end();
  });
}
