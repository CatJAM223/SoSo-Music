import Hls from 'hls.js';
import { AudioCacheService } from './audioCacheService.ts';
import { createPlayerAudio, releasePlayerAudio } from './createPlayerAudio.ts';
import type { Track } from '../types/index.ts';
import { platformBridge } from '../bridge/platformBridge.ts';
import { isPlayableDirectAudioUrl } from '../utils/audioUrlValidator.ts';
import { resolvePlayerStream } from './playerStreamResolution.ts';

/** One silent, bounded lookahead. Ownership transfers to playback on take(). */
export class PreparedAudio {
  private entry?: {
    id: string;
    audio: HTMLAudioElement;
    hls: Hls | null;
    url: string;
    at: number;
    detach: () => void;
  };
  private controller?: AbortController;
  private target = '';
  private lastAttempt = { id: '', at: 0 };

  prepare(track: Track): void {
    const id = String(track.id);
    if (this.target === id) return;
    if (this.lastAttempt.id === id && Date.now() - this.lastAttempt.at < 15000) return;
    this.clear();
    this.lastAttempt = { id, at: Date.now() };
    this.target = id;
    const controller = new AbortController();
    this.controller = controller;
    void resolvePlayerStream(track, {}, controller.signal, (item, options, signal) =>
      platformBridge.getFullStreamUrl(item, options, signal),
    )
      .then((url) => {
        if (controller.signal.aborted) return;
        if (!url || !isPlayableDirectAudioUrl(url)) {
          this.clear();
          return;
        }
        const audio = createPlayerAudio();
        audio.preload = 'auto';
        audio.autoplay = false;
        const hls =
          AudioCacheService.isHlsUrl(url) && Hls.isSupported()
            ? new Hls({
                enableWorker: true,
                maxBufferLength: 10,
                maxMaxBufferLength: 15,
                maxBufferSize: 4 * 1024 * 1024,
                backBufferLength: 0,
              })
            : null;
        const fail = () => this.clear();
        const hlsError = (_: unknown, data: { fatal: boolean }) => {
          if (data.fatal) fail();
        };
        const timer = setTimeout(() => this.clear(), 5 * 60 * 1000);
        const detach = () => {
          clearTimeout(timer);
          audio.removeEventListener('error', fail);
          hls?.off(Hls.Events.ERROR, hlsError);
        };
        this.entry = { id, audio, hls, url, at: Date.now(), detach };
        audio.addEventListener('error', fail);
        if (hls) {
          hls.on(Hls.Events.ERROR, hlsError);
          hls.attachMedia(audio);
          hls.loadSource(url);
        } else {
          audio.src = url;
          audio.load();
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) this.clear();
      });
  }

  take(id: string | number) {
    const entry = this.entry;
    if (
      !entry ||
      entry.id !== String(id) ||
      entry.audio.readyState < 3 ||
      Date.now() - entry.at > 5 * 60 * 1000
    ) {
      this.clear();
      return undefined;
    }
    entry.detach();
    this.entry = undefined;
    this.target = '';
    this.controller = undefined;
    return entry;
  }

  clear(): void {
    this.controller?.abort();
    this.controller = undefined;
    const entry = this.entry;
    this.entry = undefined;
    this.target = '';
    if (entry) {
      entry.detach();
      entry.hls?.destroy();
      entry.audio.pause();
      entry.audio.removeAttribute('src');
      entry.audio.load();
      releasePlayerAudio(entry.audio);
    }
  }
}
