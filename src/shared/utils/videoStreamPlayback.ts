import type Hls from 'hls.js';

export function isHlsVideoUrl(url: string): boolean {
  return /\.m3u8(?:[?#]|$)|\/manifest\/hls(?:_|\/|\?)/i.test(url);
}

/** A clip has no audio output; keep buffering bounded and dispose on close or track change. */
export function attachHlsVideo(
  video: HTMLVideoElement,
  url: string,
  onFailure: () => void,
): () => void {
  let active = true,
    hls: Hls | undefined,
    recovered = false;
  const fail = () => {
    if (active) {
      active = false;
      clearTimeout(timer);
      hls?.destroy();
      onFailure();
    }
  };
  const ready = () => clearTimeout(timer);
  const timer = setTimeout(fail, 15000);
  video.addEventListener('loadeddata', ready, { once: true });
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
  } else {
    void import('hls.js')
      .then(({ default: Hls }) => {
        if (!active) return;
        if (!Hls.isSupported()) {
          fail();
          return;
        }
        hls = new Hls({
          maxBufferLength: 10,
          maxMaxBufferLength: 20,
          backBufferLength: 5,
          maxBufferSize: 24 * 1024 * 1024,
          manifestLoadingMaxRetry: 1,
          levelLoadingMaxRetry: 1,
          fragLoadingMaxRetry: 1,
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!active || !data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
            recovered = true;
            hls?.recoverMediaError();
          } else fail();
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      })
      .catch(fail);
  }
  return () => {
    active = false;
    clearTimeout(timer);
    video.removeEventListener('loadeddata', ready);
    hls?.destroy();
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
}

/** Progressive video may stall without emitting an error; never leave it waiting indefinitely. */
export function watchVideoStartup(
  video: HTMLVideoElement,
  onFailure: () => void,
  url?: string,
): () => void {
  // The effect owns the source, so a cleanup/re-attachment restores it even on the same DOM node.
  if (url) video.src = url;
  const release = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
  if (video.readyState >= 2) return release;
  const ready = () => clearTimeout(timer);
  const timer = setTimeout(onFailure, 15000);
  video.addEventListener('loadeddata', ready, { once: true });
  return () => {
    clearTimeout(timer);
    video.removeEventListener('loadeddata', ready);
    release();
  };
}

export function syncVideoPlayback(video: HTMLVideoElement, time: number, playing: boolean): void {
  // HLS can attach after the audio is already playing; defer seeking until metadata exists.
  if (video.readyState >= 1 && !video.seeking && Number.isFinite(time)) {
    const target = Math.max(
      0,
      Number.isFinite(video.duration) ? Math.min(time, Math.max(0, video.duration - 0.05)) : time,
    );
    if (Math.abs(video.currentTime - target) > 0.8) {
      try {
        video.currentTime = target;
      } catch {}
    }
  }
  if (playing) {
    if (video.paused) void video.play().catch(() => {});
  } else if (!video.paused) video.pause();
}

export interface ClipPlaybackState {
  time: number;
  playing: boolean;
  enabled: boolean;
}

/** Readiness is not playback: keep detecting frozen clips after their first frame. */
export function watchVideoProgress(
  video: HTMLVideoElement,
  getPlayback: () => ClipPlaybackState,
  onFailure: (reason: string) => void,
  onEvent: (event: string) => void = () => {},
): () => void {
  let active = true,
    lastPosition = video.currentTime,
    lastProgress = Date.now();
  let lastFrames = video.getVideoPlaybackQuality?.().totalVideoFrames;
  const sync = () => {
    if (!active) return;
    const playback = getPlayback();
    syncVideoPlayback(video, playback.time, playback.enabled && playback.playing);
  };
  const ready = () => {
    onEvent('frame-ready');
    sync();
  };
  const playing = () => onEvent('playing');
  const timer = setInterval(() => {
    if (!active) return;
    const playback = getPlayback(),
      now = Date.now();
    // A paused clip and a shorter clip which has finished are valid states.
    const frames = video.getVideoPlaybackQuality?.().totalVideoFrames;
    const advanced =
      frames !== undefined && lastFrames !== undefined
        ? frames > lastFrames
        : !video.seeking &&
          video.readyState >= 2 &&
          Math.abs(video.currentTime - lastPosition) > 0.05;
    if (!playback.enabled || !playback.playing || video.ended || advanced) {
      lastProgress = now;
      lastPosition = video.currentTime;
      lastFrames = frames;
      return;
    }
    if (now - lastProgress >= 15000) {
      active = false;
      clearInterval(timer);
      onFailure('stalled readyState=' + video.readyState + ' networkState=' + video.networkState);
    }
  }, 1000);
  video.addEventListener('loadedmetadata', sync);
  video.addEventListener('canplay', sync);
  video.addEventListener('seeked', sync);
  video.addEventListener('loadeddata', ready);
  video.addEventListener('playing', playing);
  return () => {
    active = false;
    clearInterval(timer);
    video.removeEventListener('loadedmetadata', sync);
    video.removeEventListener('canplay', sync);
    video.removeEventListener('seeked', sync);
    video.removeEventListener('loadeddata', ready);
    video.removeEventListener('playing', playing);
  };
}
