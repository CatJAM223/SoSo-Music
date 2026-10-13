import http from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  LOCAL_LISTEN_PORT,
  parseLocalListenTrack,
  buildSoSoListenUrl,
} from '../../../shared/utils/localListenLink.ts';
import type { Track } from '../../../shared/types/index.ts';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

function isUserNavigation(headers: http.IncomingHttpHeaders): boolean {
  const purpose = String(headers['sec-purpose'] || headers.purpose || '').toLowerCase();
  return (
    headers['sec-fetch-user'] === '?1' &&
    headers['sec-fetch-mode'] === 'navigate' &&
    headers['sec-fetch-dest'] === 'document' &&
    !purpose.includes('prefetch') &&
    !purpose.includes('prerender')
  );
}

function listenPage(track: Track, token: string, nonce: string, automatic: boolean): string {
  const directUrl = buildSoSoListenUrl({
    trackId: track.id,
    source: track.source,
    title: track.title,
    artist: track.artist.name,
    duration: track.duration,
    coverUrl: track.album.cover_xl || track.album.cover_big || track.cover_url,
  })!;
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Слушать в SoSo Music</title>
<style nonce="${nonce}">
body{margin:0;background:#121212;color:#eee;font:16px system-ui;display:grid;min-height:100dvh;place-items:center}
main{width:min(420px,80vw);padding:32px}h1{font-size:28px;margin:24px 0 8px;overflow-wrap:anywhere}
p{color:#aaa;overflow-wrap:anywhere}button{font:600 16px system-ui;background:#eab900;color:#141414;border:0;border-radius:24px;padding:14px 24px;cursor:pointer}
button:disabled{opacity:.6;cursor:default}small,a{color:#888}a{font-size:13px}[hidden]{display:none}
</style>
<main><small>SoSo Music</small><h1>${escapeHtml(track.title)}</h1><p>${escapeHtml(track.artist.name)}</p>
<button id="play"${automatic ? ' hidden' : ''}>Слушать в SoSo Music</button>
<p id="status" role="status">${automatic ? 'Открываем трек в SoSo Music…' : 'Трек откроется в запущенном плеере.'}</p>
<a id="direct" href="${escapeHtml(directUrl)}">Открыть приложение</a></main>
<script nonce="${nonce}">
const button=document.getElementById("play"),status=document.getElementById("status");
let busy=false,attemptedAutomatic=false;
async function play(){
  if(busy)return;
  busy=true;button.disabled=true;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch("/play/${token}",{method:"POST",headers:{"X-SoSo-Listen":"1"},signal:controller.signal});
    if(!response.ok){
      if(response.status===410){
        button.onclick=()=>location.reload();
        throw new Error("Ссылка устарела. Нажмите «Повторить».");
      }
      throw new Error("Не удалось передать трек в плеер. Попробуйте ещё раз.");
    }
    button.hidden=true;
    status.textContent="Трек передан в SoSo Music. Эту вкладку можно закрыть.";
  }catch(error){
    button.hidden=false;button.disabled=false;button.textContent="Повторить";
    status.textContent=error?.message==="Ссылка устарела. Нажмите «Повторить»."?error.message:"Не удалось открыть трек. Нажмите «Повторить».";
  }finally{busy=false;clearTimeout(timeout);}
}
button.onclick=play;
function automaticPlay(){
  if(!${automatic}||attemptedAutomatic||window.top!==window.self||document.prerendering||document.visibilityState!=="visible")return;
  attemptedAutomatic=true;
  document.removeEventListener("visibilitychange",automaticPlay);
  document.removeEventListener("prerenderingchange",automaticPlay);
  void play();
}
document.addEventListener("visibilitychange",automaticPlay);
document.addEventListener("prerenderingchange",automaticPlay);
automaticPlay();
</script></html>`;
}

/** Loopback-only receiver: explicit browser navigation can hand off automatically; previews stay inert. */
export class LocalListenServer {
  private server: http.Server | null = null;
  private tokens = new Map<string, { track: Track; expires: number }>();
  public origin: string | null = null;

  async start(onListen: (track: Track) => void, port = LOCAL_LISTEN_PORT): Promise<string | null> {
    if (this.server) return this.origin;
    const server = http.createServer((req, res) => {
      const host = new URL(this.origin!).host;
      if (req.headers.host !== host) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const url = new URL(req.url || '/', this.origin!);
      const now = Date.now();
      for (const [token, value] of this.tokens) if (value.expires <= now) this.tokens.delete(token);
      if (req.method === 'GET' && url.pathname === '/listen') {
        const track = parseLocalListenTrack(url);
        if (!track || (req.url || '').length > 4096) {
          res.writeHead(400);
          res.end('Некорректный трек');
          return;
        }
        while (this.tokens.size >= 32) this.tokens.delete(this.tokens.keys().next().value!);
        const token = randomBytes(24).toString('hex'),
          nonce = randomBytes(16).toString('base64');
        this.tokens.set(token, { track, expires: now + 120000 });
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; script-src 'nonce-" +
            nonce +
            "'; style-src 'nonce-" +
            nonce +
            "'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        );
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(listenPage(track, token, nonce, isUserNavigation(req.headers)));
        return;
      }
      if (req.method === 'POST' && url.pathname.startsWith('/play/')) {
        if (req.headers.origin !== this.origin || req.headers['x-soso-listen'] !== '1') {
          res.writeHead(403);
          res.end();
          return;
        }
        const token = url.pathname.slice(6),
          item = this.tokens.get(token);
        if (!item || item.expires <= now) {
          res.writeHead(410);
          res.end();
          return;
        }
        try {
          onListen(item.track);
          this.tokens.delete(token);
          res.writeHead(204);
          res.end();
        } catch {
          res.writeHead(503);
          res.end();
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.maxHeadersCount = 32;
    server.headersTimeout = 5000;
    server.requestTimeout = 5000;
    const started = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (!started) {
      server.close();
      return null;
    }
    const address = server.address();
    this.origin =
      'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : port);
    this.server = server;
    server.unref();
    return this.origin;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.origin = null;
    this.tokens.clear();
  }
}
