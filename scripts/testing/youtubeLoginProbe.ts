import { electronFetch } from '../../src/desktop/main/services/electronFetch';
import { app, BrowserWindow, session } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { YouTubeAccountService } from '../../src/desktop/main/services/youtubeAccount';
import { YouTubeMusicService } from '../../src/desktop/main/services/youtubeMusic';
import { probeYouTubeMedia } from '../../src/desktop/main/services/youtubeMediaProbe';
import { YouTubeMusicTransport } from '../../src/desktop/main/services/youtubeMusicTransport';
const folder = path.resolve(process.argv[2]);
app.setPath('userData', path.join(folder, 'native-profile'));
app.on('window-all-closed', () => {});
app.on('browser-window-created', (_event, win) => win.hide());
const pause = () => new Promise((resolve) => setTimeout(resolve, 40));
async function until(check: () => boolean) {
  const end = Date.now() + 6000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Fixture timed out');
    await pause();
  }
}
app.whenReady().then(async () => {
  const account: any = new YouTubeAccountService(
    () => null,
    () => {},
  );
  const browser = session.fromPartition('persist:soso-youtube-account');
  const seen: string[] = [];
  let external = 0;
  let accountPlayerRequests = 0;
  let denyPlayer = false;
  let combinedPlayer = false;
  let mediaBytes: Buffer = Buffer.from([1, 2, 3]);
  let mediaRequests = 0;
  let mediaRedirect = false;
  let untrustedRedirect = false;
  let mediaRejectOnce = false;
  let watchRecovery = false;
  let watchRequests = 0;
  let mediaGate: Promise<void> | null = null;
  let notifyMediaGate: (() => void) | null = null;
  try {
    await account.disconnect();
    const handleFixture = async (request: Request) => {
      const url = new URL(request.url);
      seen.push(url.hostname);
      if (
        ![
          'www.youtube.com',
          'accounts.google.com',
          'accounts.google.ro',
          'accounts.youtube.com',
          'embedded.example.test',
          'rr1.googlevideo.com',
          'rr2.googlevideo.com',
        ].includes(url.hostname)
      ) {
        external++;
        return new Response('Blocked', { status: 403 });
      }
      if (url.hostname.endsWith('.googlevideo.com')) {
        if (mediaGate) {
          const gate = mediaGate;
          mediaGate = null;
          notifyMediaGate?.();
          await gate;
        }
        mediaRequests++;
        if (url.searchParams.get('c') === 'WEB')
          assert.match(request.headers.get('user-agent') || '', /Safari/);
        assert.equal(request.headers.get('cookie'), null);
        assert.equal(request.headers.get('authorization'), null);
        if (mediaRejectOnce) {
          mediaRejectOnce = false;
          return new Response('Forbidden', {
            status: 403,
            headers: { 'content-type': 'text/plain' },
          });
        }
        if (untrustedRedirect) return Response.redirect('https://evil.test/blocked', 302);
        if (mediaRedirect && url.hostname === 'rr1.googlevideo.com')
          return Response.redirect('https://rr2.googlevideo.com' + url.pathname + url.search, 302);
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '');
        const start = range ? Number(range[1]) : 0,
          end =
            range && range[2]
              ? Math.min(Number(range[2]), mediaBytes.length - 1)
              : mediaBytes.length - 1;
        const part = mediaBytes.subarray(start, end + 1);
        return new Response(part, {
          status: range ? 206 : 200,
          headers: {
            'content-type': 'video/webm',
            'accept-ranges': 'bytes',
            'content-length': String(part.length),
            ...(range
              ? { 'content-range': 'bytes ' + start + '-' + end + '/' + mediaBytes.length }
              : {}),
          },
        });
      }
      if (url.hostname === 'www.youtube.com' && url.pathname === '/youtubei/v1/player') {
        accountPlayerRequests++;
        assert.equal(request.method, 'POST');
        assert.match(request.headers.get('authorization') || '', /^SAPISIDHASH \d+_[a-f0-9]{40}$/);
        assert.ok(request.headers.get('cookie')?.includes('SAPISID=synthetic-local-only'));
        const payload = await request.json();
        assert.equal(payload.videoId, 'W0LiTBNjJ_o');
        assert.equal(payload.context.client.browserName, 'Safari');
        assert.equal(
          payload.playbackContext.contentPlaybackContext.html5Preference,
          'HTML5_PREF_WANTS',
        );
        if (denyPlayer)
          return Response.json({
            playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in' },
            videoDetails: { videoId: 'W0LiTBNjJ_o' },
          });
        if (combinedPlayer)
          return Response.json({
            playabilityStatus: { status: 'OK' },
            videoDetails: { videoId: 'W0LiTBNjJ_o', lengthSeconds: '2' },
            streamingData: {
              expiresInSeconds: '3600',
              adaptiveFormats: Array.from({ length: 22 }, (_, i) => ({
                itag: 140 + i,
                mimeType: 'audio/mp4',
                audioQuality: 'AUDIO_QUALITY_MEDIUM',
                bitrate: 128000,
              })),
              formats: [
                {
                  itag: 43,
                  mimeType: 'video/webm; codecs="vp8, opus"',
                  qualityLabel: '144p',
                  height: 144,
                  bitrate: 160000,
                  url: 'https://rr1.googlevideo.com/videoplayback?itag=43',
                },
              ],
            },
          });
        return Response.json({
          playabilityStatus: { status: 'OK' },
          videoDetails: { videoId: 'W0LiTBNjJ_o', lengthSeconds: '106' },
          streamingData: {
            expiresInSeconds: '3600',
            adaptiveFormats: [
              {
                itag: 140,
                bitrate: 128000,
                mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                audioQuality: 'AUDIO_QUALITY_MEDIUM',
                url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
              },
            ],
          },
        });
      }
      if (url.hostname === 'www.youtube.com' && url.pathname === '/watch' && watchRecovery) {
        watchRequests++;
        assert.equal(url.searchParams.get('v'), 'W0LiTBNjJ_o');
        assert.ok(request.headers.get('cookie')?.includes('SAPISID=synthetic-local-only'));
        const response = {
          playabilityStatus: { status: 'OK' },
          videoDetails: { videoId: 'W0LiTBNjJ_o', lengthSeconds: '106' },
          streamingData: {
            formats: [
              {
                itag: 43,
                mimeType: 'video/webm; codecs="vp8, opus"',
                bitrate: 160000,
                url: 'https://rr1.googlevideo.com/videoplayback?itag=43&c=WEB',
              },
            ],
          },
        };
        return new Response(
          '<script>var ytInitialPlayerResponse = ' + JSON.stringify(response) + ';</script>',
          { headers: { 'content-type': 'text/html' } },
        );
      }
      const headers = { 'content-type': 'text/html' };
      if (url.hostname === 'accounts.google.com' && url.pathname === '/regional')
        return Response.redirect('https://accounts.google.ro/challenge', 302);
      if (url.hostname === 'accounts.youtube.com') {
        for (const name of ['SAPISID', 'SID'])
          await browser.cookies.set({
            url: 'https://www.youtube.com/',
            domain: '.youtube.com',
            path: '/',
            secure: true,
            httpOnly: true,
            name,
            value: 'synthetic-local-only',
          });
        return Response.redirect('https://www.youtube.com/?fixture=done', 302);
      }
      if (url.hostname === 'accounts.google.com' && url.pathname === '/embedded')
        return Response.redirect('https://embedded.example.test/frame', 302);
      const body = url.hostname.startsWith('accounts.google.')
        ? 'Challenge fixture'
        : 'YouTube fixture';
      const iframe = url.hostname.startsWith('accounts.google.')
        ? '<iframe src="https://accounts.google.com/embedded"></iframe>'
        : '';
      return new Response(
        '<!doctype html><title>' + body + '</title><p>' + body + '</p>' + iframe,
        { headers },
      );
    };
    browser.protocol.handle('https', handleFixture);
    session.defaultSession.protocol.handle('https', handleFixture);
    await account.connect();
    const first = account.loginWindow as BrowserWindow;
    await until(
      () =>
        first.webContents.getURL() === 'https://www.youtube.com/' && !first.webContents.isLoading(),
    );
    await account.connect();
    assert.equal(account.loginWindow, first);
    first.minimize();
    await account.connect();
    assert.equal(first.isMinimized(), false);
    first.close();
    await until(() => first.isDestroyed());
    await account.connect();
    const win = account.loginWindow as BrowserWindow;
    assert.notEqual(win, first);
    await until(
      () => win.webContents.getURL() === 'https://www.youtube.com/' && !win.webContents.isLoading(),
    );
    await win.webContents.executeJavaScript(
      'location.href="https://accounts.google.com/regional?fixture=synthetic"',
    );
    await until(
      () => win.webContents.getURL().includes('accounts.google.ro') && !win.webContents.isLoading(),
    );
    await until(() => seen.includes('embedded.example.test'));
    assert.equal((await account.status()).error, undefined);
    await account.connect();
    assert.equal(account.loginWindow, win);
    assert.ok(win.webContents.getURL().includes('challenge'));
    await win.webContents.executeJavaScript(
      'location.href="https://accounts.youtube.com/accounts/SetSID?fixture=synthetic"',
    );
    await until(() => win.isDestroyed());
    assert.equal((await account.status()).connected, true);
    assert.equal((await account.status()).loginOpen, false);
    assert.ok(seen.includes('accounts.youtube.com'));
    assert.equal(external, 0);
    await account.connect();
    const renewed = account.loginWindow as BrowserWindow;
    await until(
      () =>
        renewed.webContents.getURL() === 'https://www.youtube.com/' &&
        !renewed.webContents.isLoading(),
    );
    await renewed.webContents.executeJavaScript(
      'location.href="https://accounts.google.com/challenge"',
    );
    await until(
      () =>
        renewed.webContents.getURL().includes('accounts.google.com') &&
        !renewed.webContents.isLoading(),
    );
    await renewed.webContents.executeJavaScript(
      'location.href="https://accounts.youtube.com/accounts/SetSID?fixture=renew"',
    );
    await until(() => renewed.isDestroyed());
    assert.ok(seen.includes('accounts.google.ro'));
    // Real library parsing and authenticated transport through Electron's Session.fetch.
    // Local bootstrap omits provider/player-script discovery; this fixture never contacts Google.
    const { Innertube } = await import('youtubei.js');
    const client = await Innertube.create({
      cookie: 'SAPISID=synthetic-local-only; SID=synthetic-local-only',
      generate_session_locally: true,
      retrieve_player: false,
      retrieve_innertube_config: false,
      enable_session_cache: false,
      fetch: (input, init) => account.fetch(input, init),
    });
    account.getClient = async () => client;
    YouTubeMusicTransport.fetch = (url, init) => electronFetch(url, init);
    const stream = await account.resolve('W0LiTBNjJ_o', {});
    assert.equal(stream.url, 'https://rr1.googlevideo.com/videoplayback?itag=140');
    assert.equal(stream.duration, 106);
    assert.equal(accountPlayerRequests, 1);
    assert.equal(external, 0);
    denyPlayer = true;
    await assert.rejects(account.resolve('W0LiTBNjJ_o', {}), /YOUTUBE_AUDIO_LOGIN_REQUIRED/);
    denyPlayer = false;
    const refreshed = await account.refresh();
    assert.equal(refreshed.connected, true);
    assert.equal(refreshed.error, undefined);
    assert.equal(accountPlayerRequests, 3);
    assert.equal(external, 0);

    // Exercise manual redirects and one fresh signed player request through actual Chromium fetch.
    mediaRedirect = true;
    const redirected = await probeYouTubeMedia(
      'https://rr1.googlevideo.com/videoplayback?itag=140',
      'audio',
    );
    assert.deepEqual(redirected, {
      ok: true,
      url: 'https://rr2.googlevideo.com/videoplayback?itag=140',
    });
    const redirectedManifest = await account.fetch('https://rr1.googlevideo.com/manifest/hls');
    assert.equal(redirectedManifest.status, 200);
    await redirectedManifest.body?.cancel().catch(() => {});
    mediaRedirect = false;
    untrustedRedirect = true;
    assert.deepEqual(
      await probeYouTubeMedia('https://rr1.googlevideo.com/videoplayback', 'audio'),
      { ok: false, reason: 'cdn-redirect', status: 302 },
    );
    await assert.rejects(
      account.fetch('https://rr1.googlevideo.com/manifest/hls'),
      (error: any) => error.cause?.message === 'cdn-redirect',
    );
    assert.equal(external, 0);
    untrustedRedirect = false;
    mediaRejectOnce = true;
    const beforeRecovery = accountPlayerRequests;
    const recovered = await account.resolve('W0LiTBNjJ_o', { allowSessionRecovery: true });
    assert.equal(recovered.deliveryVerified, true);
    assert.equal(accountPlayerRequests, beforeRecovery + 2);
    assert.equal((await account.status()).connected, true);
    mediaRequests = 0;

    // Reproduce a wave click joining prefetch while another track has already consumed the reset cooldown.
    account.lastDeliveryRecoveryAt = Date.now();
    watchRecovery = true;
    mediaRejectOnce = true;
    const beforeWatch = accountPlayerRequests;
    let releaseMediaGate!: () => void;
    const mediaStarted = new Promise<void>((resolve) => {
      notifyMediaGate = resolve;
    });
    mediaGate = new Promise<void>((resolve) => {
      releaseMediaGate = resolve;
    });
    YouTubeMusicService.setAccountResolver((id, options) => account.resolve(id, options));
    YouTubeMusicTransport.postPlayer = async () => {
      throw new Error(
        'Wave click must recover the connected account instead of trying anonymous playback',
      );
    };
    const prefetched = YouTubeMusicService.resolveDirectAudioStream('W0LiTBNjJ_o');
    await mediaStarted;
    const clicked = YouTubeMusicService.resolveDirectAudioStream('W0LiTBNjJ_o', false, false, {
      allowSessionRecovery: true,
    });
    releaseMediaGate();
    const recoveredUrls = await Promise.all([prefetched, clicked]);
    assert.equal(recoveredUrls[0], recoveredUrls[1]);
    assert.ok(recoveredUrls[1].includes('itag=43'));
    assert.equal(YouTubeMusicService.getStreamRoute('W0LiTBNjJ_o')?.via, 'account');
    assert.equal(accountPlayerRequests, beforeWatch + 1);
    assert.equal(watchRequests, 1);
    assert.equal(external, 0);
    assert.equal((await account.status()).connected, true);
    watchRecovery = false;
    mediaRequests = 0;

    // A pure speculative request must warm the URL cache without consuming active recovery.
    account.preferredWatchUntil = 0;
    mediaRequests = 0;
    mediaRejectOnce = true;
    watchRecovery = true;
    YouTubeMusicService.invalidateSessionCaches();
    const beforeWarm = {
      players: accountPlayerRequests,
      pages: watchRequests,
      recovery: account.lastDeliveryRecoveryAt,
    };
    const warmUrl = await YouTubeMusicService.resolveDirectAudioStream('W0LiTBNjJ_o');
    assert.ok(warmUrl.includes('itag=43'));
    assert.equal(accountPlayerRequests, beforeWarm.players + 1);
    assert.equal(watchRequests, beforeWarm.pages + 1);
    assert.equal(account.lastDeliveryRecoveryAt, beforeWarm.recovery);
    const beforeClick = {
      players: accountPlayerRequests,
      pages: watchRequests,
      media: mediaRequests,
    };
    assert.equal(
      await YouTubeMusicService.resolveDirectAudioStream('W0LiTBNjJ_o', false, false, {
        allowSessionRecovery: true,
      }),
      warmUrl,
    );
    assert.equal(accountPlayerRequests, beforeClick.players);
    assert.equal(watchRequests, beforeClick.pages);
    assert.equal(mediaRequests, beforeClick.media);
    const routeStart = {
      players: accountPlayerRequests,
      pages: watchRequests,
      media: mediaRequests,
    };
    assert.equal((await account.resolve('W0LiTBNjJ_o', {}))?.deliveryVerified, true);
    assert.equal(accountPlayerRequests, routeStart.players);
    assert.equal(watchRequests, routeStart.pages + 1);
    assert.equal(mediaRequests, routeStart.media + 1);
    watchRecovery = false;
    mediaRequests = 0;

    // Generate known sound plus video, then decode the returned URL through Chromium <audio>.
    // The analyser proves that audio samples exist; play() resolving alone would miss silent video.
    const mediaWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        session: session.defaultSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    try {
      await mediaWindow.loadURL('https://www.youtube.com/fixture-media');
      const bytes: number[] = await mediaWindow.webContents.executeJavaScript(`(async()=>{
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=144;
      const pen=canvas.getContext('2d');pen.fillStyle='#20c070';pen.fillRect(0,0,256,144);
      const context=new AudioContext();await context.resume();
      const destination=context.createMediaStreamDestination(),oscillator=context.createOscillator();oscillator.frequency.value=440;oscillator.connect(destination);oscillator.start();
      const video=canvas.captureStream(10),stream=new MediaStream([...video.getVideoTracks(),...destination.stream.getAudioTracks()]);
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus'}),chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);
      const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
      const draw=setInterval(()=>{pen.fillRect(0,0,256,144);},50);await new Promise(resolve=>setTimeout(resolve,1900));
      recorder.stop();await stopped;clearInterval(draw);oscillator.stop();stream.getTracks().forEach(track=>track.stop());await context.close();
      return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));
    })()`);
      mediaBytes = Buffer.from(bytes);
      assert.ok(mediaBytes.length > 1000);
      combinedPlayer = true;
      YouTubeMusicTransport.fetch = (url, init) => electronFetch(url, init);
      YouTubeMusicTransport.postPlayer = async () => {
        throw new Error('Combined fixture must stay on account playback');
      };
      YouTubeMusicService.setAccountResolver((id, options) => account.resolve(id, options));
      const url = await YouTubeMusicService.resolveDirectAudioStream('W0LiTBNjJ_o');
      assert.equal(YouTubeMusicService.getStreamRoute('W0LiTBNjJ_o')?.via, 'account');
      assert.equal(mediaRequests, 1);
      const decoded = await mediaWindow.webContents.executeJavaScript(
        `(async()=>{
      const audio=new Audio();audio.crossOrigin='anonymous';audio.src=` +
          JSON.stringify(url) +
          `;audio.loop=true;
      const context=new AudioContext();await context.resume();const source=context.createMediaElementSource(audio),analyser=context.createAnalyser(),silent=context.createGain();
      silent.gain.value=0;source.connect(analyser);analyser.connect(silent);silent.connect(context.destination);
      await audio.play();let peak=0,advanced=false;const samples=new Float32Array(analyser.fftSize);
      for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,25));analyser.getFloatTimeDomainData(samples);
        peak=Math.max(peak,Math.sqrt(samples.reduce((sum,sample)=>sum+sample*sample,0)/samples.length));advanced=audio.currentTime>0.08;
        if(peak>0.02&&advanced)break;
      }
      const result={peak,advanced,readyState:audio.readyState};audio.pause();audio.removeAttribute('src');audio.load();source.disconnect();await context.close();return result;
    })()`,
      );
      assert.ok(decoded.advanced);
      assert.ok(decoded.peak > 0.02, 'Selected progressive stream must contain measurable sound');
      assert.ok(mediaRequests >= 2);
      assert.equal(external, 0);
      console.log('NATIVE_COMBINED_AUDIO_OK ' + JSON.stringify(decoded));
    } finally {
      mediaWindow.destroy();
    }
    const results = {
      nativePrefetchWarmsWatchCache: true,
      nativeWorkingRouteSkipsFailedPlayer: true,
      nativeClickJoinsPrefetchDuringCooldown: true,
      nativeWatch403RecoveryVerified: true,
      nativeCdnRedirectVerified: true,
      native403RecoveryVerified: true,
      combinedAccountAudioDecoded: true,
      manualRefreshKeepsNativeCookies: true,
      accountPlaybackThroughNativeTransport: true,
      regionalRedirectAllowed: true,
      iframeRedirectPreserved: true,
      existingSessionReconnected: true,
      actualChromiumRedirectAllowed: true,
      closedAndReopened: true,
      minimizedRestored: true,
      challengeNotRestarted: true,
      lateCookiesConnected: true,
      externalRequests: external,
    };
    fs.writeFileSync(path.join(folder, 'native-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await account.disconnect();
    account.dispose();
    app.exit(process.exitCode || 0);
  }
});
