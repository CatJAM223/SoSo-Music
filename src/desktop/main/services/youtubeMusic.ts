import {
  assertStreamResolveActive,
  currentStreamResolveSignal,
  streamWait,
  streamShared,
} from './streamResolveContext.ts';
import { sharedStreamResolver } from './sharedStreamResolver.ts';
import { BoundedMap } from '../../../shared/utils/boundedCache.ts';
import {
  createStreamResolveError,
  getStreamResolveFailure,
  streamHttpFailure,
  streamTransportFailure,
} from '../../../shared/utils/streamResolveError.ts';
import type {
  Album,
  Artist,
  ArtistDetails,
  StreamResolveOptions,
  Track,
} from '../../../shared/types/index.ts';
import { isArtistMatch, isTitleMatch } from '../../../shared/utils/artistParser.ts';

import { PlaybackLogger } from './playbackLogger.ts';
import { YouTubeMusicTransport } from './youtubeMusicTransport.ts';
import { probeYouTubeMedia } from './youtubeMediaProbe.ts';
import { type YouTubeAccountStream } from './youtubeAccountStream.ts';
import { recoverDesktopNetwork, resetDesktopYouTubeSession } from './desktopFetch.ts';
import {
  classifyYouTubeAudioAccessError,
  getYouTubeAudioAccessError,
} from '../../../shared/utils/youtubeAudioAccessError.ts';
import {
  getVideoPlaybackError,
  isAgeRestrictedVideo,
  VIDEO_AGE_RESTRICTED,
  VIDEO_BOT_CHECK,
  VIDEO_LOGIN_REQUIRED,
} from '../../../shared/utils/videoPlaybackError.ts';

import {
  parseDuration,
  cleanYTTitle,
  isDurationClose,
  extractAlbumFromFlexColumns,
  parseInnerTubeShelfItem,
  parseYouTubeRadioResponse,
  extractArtistsFromRuns,
  isValidYouTubeVideoId,
  parseAlbumSearchResults,
  selectYouTubeAudioFormat,
} from '../../../shared/services/parsers/youtubeMusicParser.ts';

export { parseDuration, cleanYTTitle };

function containsAnyPhrase(value: string, phrases: string[]): boolean {
  const normalizedValue = ` ${value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
  return phrases.some((phrase) => {
    const normalizedPhrase = phrase
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    return normalizedPhrase.length > 0 && normalizedValue.includes(` ${normalizedPhrase} `);
  });
}

export class YouTubeMusicService {
  private static searchCache = new Map<string, { data: Track[]; total: number }>();
  private static streamCache = new BoundedMap<
    string,
    { url: string; expiresAt: number; via?: 'account' | 'anonymous' }
  >(128, (entry) => entry.expiresAt);
  private static videoStreamRequests = new Map<string, Promise<string>>();
  private static videoStreamCache = new BoundedMap<string, { url: string; expiresAt: number }>(
    128,
    (entry) => entry.expiresAt,
  );
  private static recordingGain = new Map<string, number>();
  public static getRecordingGain(videoId: string): number | undefined {
    return this.recordingGain.get(this.cleanVideoId(videoId));
  }
  private static videoDurationCache = new BoundedMap<string, number>(1000);
  private static STREAM_CACHE_TTL = 7 * 60 * 1000;
  private static audioStreamRequests = new Map<string, Promise<string>>();
  private static playerStreamRequests = new Map<string, Promise<string>>();
  private static playerStreamOptions = new Map<string, StreamResolveOptions>();
  private static audioAccessFailures = new Map<string, { code: string; expiresAt: number }>();
  private static AUDIO_ACCESS_FAILURE_TTL = 30 * 1000;
  private static visitorDataRequest: Promise<string> | null = null;
  private static sessionEpoch = 0;
  private static sessionRecoveryRequest: Promise<void> | null = null;
  private static lastSessionRecoveryAt = Number.NEGATIVE_INFINITY;

  private static accountResolver:
    | ((videoId: string, options: StreamResolveOptions) => Promise<YouTubeAccountStream | null>)
    | null = null;

  private static accountVideoResolver:
    ((videoId: string) => Promise<YouTubeAccountStream | null>) | null = null;

  public static setAccountVideoResolver(
    resolver: typeof YouTubeMusicService.accountVideoResolver,
  ): void {
    this.accountVideoResolver = resolver;
    this.invalidateSessionCaches();
  }

  public static getStreamRoute(
    videoId: string,
  ): { via: 'account' | 'anonymous'; client: 'WEB' | 'VISIONOS' } | undefined {
    const stream = this.streamCache.get(this.cleanVideoId(videoId));
    if (!stream?.via || Date.now() >= stream.expiresAt) return undefined;
    return { via: stream.via, client: stream.via === 'account' ? 'WEB' : 'VISIONOS' };
  }

  private static logStreamRoute(videoId: string, cache: 'hit' | 'miss'): void {
    const route = this.getStreamRoute(videoId);
    if (route)
      PlaybackLogger.info(
        '[YouTubeMusic:Route] track=' +
          videoId +
          ' via=' +
          route.via +
          ' client=' +
          route.client +
          ' urlCache=' +
          cache,
      );
  }

  public static setAccountResolver(resolver: typeof YouTubeMusicService.accountResolver): void {
    this.accountResolver = resolver;
    this.invalidateSessionCaches();
  }

  /** Account changes invalidate denied/cached URLs without touching stored credentials. */
  public static invalidateSessionCaches(): void {
    this.sessionEpoch++;
    sharedStreamResolver.invalidate();
    this.cachedVisitorData = null;
    this.visitorDataRequest = null;
    this.streamCache.clear();
    this.videoStreamCache.clear();
    this.videoStreamRequests.clear();
    this.audioAccessFailures.clear();
    this.searchCache.clear();
    this.videoDurationCache.clear();
  }

  private static resetSession(): Promise<void> {
    if (this.sessionRecoveryRequest) return this.sessionRecoveryRequest;
    this.lastSessionRecoveryAt = Date.now();
    this.invalidateSessionCaches();
    PlaybackLogger.info('[YouTubeMusic:Session] Resetting session cache before one playback retry');
    const reset = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          resetDesktopYouTubeSession(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('YouTube session reset timed out')), 5000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    this.sessionRecoveryRequest = reset;
    void reset
      .finally(() => {
        if (this.sessionRecoveryRequest === reset) this.sessionRecoveryRequest = null;
      })
      .catch(() => {});
    return reset;
  }

  public static cleanVideoId(videoId: string | null | undefined): string {
    return String(videoId || '')
      .replace(/^yt_/, '')
      .replace(/^yt_art_/, '')
      .trim();
  }

  public static getVideoDuration(videoId: string): number | undefined {
    const clean = this.cleanVideoId(videoId);
    return this.videoDurationCache.get(clean);
  }

  // Innertube search filters (from Kopuz & ytmusicapi protobuf specs)
  public static PARAMS = {
    SONGS: 'EgWKAQIIAWoMEAMQBBAJEAoQDhAV',
    VIDEOS: 'EgWKAQIQAWoMEAMQBBAJEAoQDhAV',
    ALBUMS: 'EgWKAQIYAWoMEAMQBBAJEAoQDhAV',
    ARTISTS: 'EgWKAQIgAWoMEAMQBBAJEAoQDhAV',
  };

  private static cachedVisitorData: { visitorData: string; expiresAt: number } | null = null;

  /**
   * Retrieves or refreshes YouTube InnerTube visitorData
   */
  public static async getVisitorData(forceRefresh: boolean = false): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this.cachedVisitorData && now < this.cachedVisitorData.expiresAt) {
      return this.cachedVisitorData.visitorData;
    }

    if (this.visitorDataRequest) return this.visitorDataRequest;
    const request = this.requestVisitorData();
    this.visitorDataRequest = request;
    try {
      return await request;
    } finally {
      if (this.visitorDataRequest === request) this.visitorDataRequest = null;
    }
  }

  private static async requestVisitorData(): Promise<string> {
    const epoch = this.sessionEpoch;
    const now = Date.now();
    try {
      const res = await YouTubeMusicTransport.fetch(
        'https://music.youtube.com/youtubei/v1/visitor_id',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'WEB_REMIX',
                clientVersion: '1.20250910.01.00',
                hl: 'en',
                gl: 'US',
              },
            },
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        },
      );

      if (res.ok) {
        const json = await res.json();
        const visitorData = json?.responseContext?.visitorData;
        if (epoch !== this.sessionEpoch) {
          if (this.sessionRecoveryRequest) await this.sessionRecoveryRequest;
          return this.getVisitorData();
        }
        if (visitorData && typeof visitorData === 'string') {
          this.cachedVisitorData = { visitorData, expiresAt: now + 12 * 60 * 60 * 1000 };
          return visitorData;
        }
      }
    } catch (e) {
      console.warn('[YouTubeMusicService] Failed to fetch visitorData:', e);
    }

    return this.cachedVisitorData?.visitorData || '';
  }

  /**
   * Resolves direct high-quality audio stream URL using Kopuz VisionOS InnerTube client
   * Selects direct formats when YouTube allows playback for the current session.
   */
  public static async resolveDirectAudioStream(
    videoId: string,
    isRetry: boolean = false,
    forceRefresh: boolean = false,
    formatOptions: StreamResolveOptions = {},
  ): Promise<string> {
    assertStreamResolveActive();
    const cleanVid = this.cleanVideoId(videoId);
    if (!cleanVid) return '';
    if (this.sessionRecoveryRequest) await streamShared(() => this.sessionRecoveryRequest);
    // A working cached stream remains usable even if another video requires sign-in.
    const cached = this.streamCache.get(cleanVid);
    if (
      !forceRefresh &&
      !formatOptions.preferAlternateFormat &&
      cached &&
      Date.now() < cached.expiresAt
    ) {
      this.logStreamRoute(cleanVid, 'hit');
      return cached.url;
    }
    if (forceRefresh) this.audioAccessFailures.delete(cleanVid);
    const blocked = this.audioAccessFailures.get(cleanVid);
    const key = JSON.stringify([
      cleanVid,
      isRetry,
      forceRefresh,
      !!formatOptions.preferAlternateFormat,
      formatOptions.excludeItag || 0,
      !!formatOptions.allowSessionRecovery,
      this.sessionEpoch,
    ]);
    const scoped = !!currentStreamResolveSignal();
    const pending = !scoped && this.audioStreamRequests.get(key);
    if (pending) return pending;
    const epoch = this.sessionEpoch;
    const request = (async () => {
      try {
        if (blocked && Date.now() < blocked.expiresAt) throw new Error(blocked.code);
        if (blocked) this.audioAccessFailures.delete(cleanVid);
        return await streamWait(
          this.requestSharedAudioStream(cleanVid, isRetry, forceRefresh, formatOptions),
        );
      } catch (error) {
        assertStreamResolveActive();
        if (
          !formatOptions.allowSessionRecovery ||
          isRetry ||
          getYouTubeAudioAccessError(error) !== 'verification-required'
        )
          throw error;
        const pendingReset = this.sessionRecoveryRequest;
        const sessionChanged = epoch !== this.sessionEpoch;
        // One reset per challenged session, shared by concurrent playback requests.
        if (!pendingReset && !sessionChanged && Date.now() - this.lastSessionRecoveryAt < 30000)
          throw error;
        try {
          if (pendingReset) await streamShared(() => pendingReset);
          else if (!sessionChanged) await streamShared(() => this.resetSession());
        } catch (resetError) {
          assertStreamResolveActive();
          PlaybackLogger.warn('[YouTubeMusic:Session] Session reset failed', resetError);
          throw error;
        }
        try {
          const url = await streamWait(
            this.requestSharedAudioStream(cleanVid, true, false, formatOptions),
          );
          PlaybackLogger.info(
            '[YouTubeMusic:Session] Playback retry completed' +
              (url ? ' successfully' : ' without a stream'),
          );
          return url;
        } catch (retryError) {
          assertStreamResolveActive();
          PlaybackLogger.warn(
            '[YouTubeMusic:Session] Verification still required after session reset',
          );
          throw retryError;
        }
      }
    })();
    if (!scoped) this.audioStreamRequests.set(key, request);
    try {
      return await streamWait(request);
    } finally {
      if (this.audioStreamRequests.get(key) === request) this.audioStreamRequests.delete(key);
    }
  }

  /** Playback and prefetch share transport work even though only playback may recover the session. */
  private static async requestSharedAudioStream(
    videoId: string,
    isRetry: boolean,
    forceRefresh: boolean,
    options: StreamResolveOptions,
  ): Promise<string> {
    assertStreamResolveActive();
    const key = JSON.stringify([
      videoId,
      isRetry,
      forceRefresh,
      !!options.preferAlternateFormat,
      options.excludeItag || 0,
      this.sessionEpoch,
    ]);
    if (currentStreamResolveSignal())
      return this.requestDirectAudioStream(videoId, isRetry, forceRefresh, options);
    const pending = this.playerStreamRequests.get(key);
    if (pending) {
      // A click can join speculative work while the account request is in flight.
      // Promote that request before delivery fails; prefetch alone never resets a session.
      const sharedOptions = this.playerStreamOptions.get(key);
      if (options.allowSessionRecovery && sharedOptions) sharedOptions.allowSessionRecovery = true;
      return pending;
    }
    const sharedOptions = { ...options };
    this.playerStreamOptions.set(key, sharedOptions);
    const request = this.requestDirectAudioStream(videoId, isRetry, forceRefresh, sharedOptions);
    this.playerStreamRequests.set(key, request);
    try {
      return await streamWait(request);
    } finally {
      if (this.playerStreamRequests.get(key) === request) {
        this.playerStreamRequests.delete(key);
        this.playerStreamOptions.delete(key);
      }
    }
  }

  private static async requestDirectAudioStream(
    videoId: string,
    isRetry: boolean = false,
    forceRefresh: boolean = false,
    formatOptions: StreamResolveOptions = {},
  ): Promise<string> {
    assertStreamResolveActive();
    if (!videoId) return '';
    const cleanVid = videoId.replace(/^yt_/, '').trim();
    if (!cleanVid) return '';

    const epoch = this.sessionEpoch;
    const startMs = Date.now();
    const now = Date.now();
    if (forceRefresh || formatOptions.preferAlternateFormat) this.streamCache.delete(cleanVid);
    const cached = this.streamCache.get(cleanVid);
    if (!forceRefresh && !formatOptions.preferAlternateFormat && cached && now < cached.expiresAt) {
      this.logStreamRoute(cleanVid, 'hit');
      return cached.url;
    }

    let accountDeliveryRejected = false;
    if (this.accountResolver) {
      let accountStream: YouTubeAccountStream | null = null;
      try {
        accountStream = await streamWait(this.accountResolver(cleanVid, formatOptions));
      } catch (error) {
        assertStreamResolveActive();
        if (getStreamResolveFailure(error)) throw error;
        // Never use a result belonging to an account that changed during resolution.
        if (epoch !== this.sessionEpoch) throw new Error('YOUTUBE_AUDIO_LOGIN_REQUIRED');
        if (error instanceof Error && getYouTubeAudioAccessError(error) === 'age-restricted') {
          this.audioAccessFailures.set(cleanVid, {
            code: error.message,
            expiresAt: Date.now() + this.AUDIO_ACCESS_FAILURE_TTL,
          });
          while (this.audioAccessFailures.size > 100)
            this.audioAccessFailures.delete(this.audioAccessFailures.keys().next().value!);
          throw error;
        }
        const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : null;
        accountDeliveryRejected = !!(
          cause &&
          typeof cause === 'object' &&
          'message' in cause &&
          cause.message === 'cdn-http-403'
        );
        // A partial/expired login must not disable publicly available playback.
        // The anonymous request still enforces YouTube's own access checks for this same video.
        PlaybackLogger.warn(
          '[YouTubeMusic] Account stream unavailable; trying anonymous playback for ' + cleanVid,
        );
      }
      if (
        accountStream?.audioIncludesVideo &&
        accountStream.audioContainer === 'progressive' &&
        !accountStream.deliveryVerified
      ) {
        const playable = await streamWait(this.checkAccountMediaUrl(accountStream.url, 'audio'));
        if (epoch !== this.sessionEpoch) throw new Error('YOUTUBE_AUDIO_LOGIN_REQUIRED');
        if (!playable) {
          PlaybackLogger.warn(
            '[YouTubeMusic:AudioRoute] track=' +
              cleanVid +
              ' account CDN rejected; trying anonymous route',
          );
          accountDeliveryRejected = true;
          accountStream = null;
        }
      }
      if (accountStream) {
        if (epoch !== this.sessionEpoch) throw new Error('YOUTUBE_AUDIO_LOGIN_REQUIRED');
        if (accountStream.duration && accountStream.duration > 0)
          this.videoDurationCache.set(cleanVid, accountStream.duration);
        if (typeof accountStream.gainDb === 'number') {
          if (this.recordingGain.size >= 128)
            this.recordingGain.delete(this.recordingGain.keys().next().value!);
          this.recordingGain.set(cleanVid, accountStream.gainDb);
        }
        this.streamCache.set(cleanVid, {
          url: accountStream.url,
          expiresAt: Date.now() + this.STREAM_CACHE_TTL,
          via: 'account',
        });
        this.logStreamRoute(cleanVid, 'miss');
        return accountStream.url;
      }
    }

    PlaybackLogger.info(
      `[YouTubeMusic] Resolving VisionOS audio stream for ${cleanVid}${isRetry ? ' (retry)' : ''}...`,
    );

    try {
      if (forceRefresh && !isRetry) {
        // Refresh this track without discarding healthy prefetches or its shared visitor session.
        this.videoStreamCache.delete(cleanVid);
        await streamShared(() => recoverDesktopNetwork());
      }
      const visitorData = await streamShared(() =>
        this.getVisitorData(isRetry || (forceRefresh && !!formatOptions.preferAlternateFormat)),
      );

      const payload = {
        context: {
          client: {
            clientName: 'VISIONOS',
            clientVersion: '1.02',
            hl: 'en',
            gl: 'US',
            osName: 'visionOS',
            osVersion: '26.5.23O471',
            deviceMake: 'Apple',
            deviceModel: 'RealityDevice17,1',
            ...(visitorData ? { visitorData } : {}),
          },
          user: { lockedSafetyMode: false },
        },
        videoId: cleanVid,
        contentCheckOk: true,
        racyCheckOk: true,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
        'X-Goog-Api-Format-Version': '1',
        'X-YouTube-Client-Name': '101',
        'X-YouTube-Client-Version': '1.02',
      };
      if (visitorData) {
        headers['X-Goog-Visitor-Id'] = visitorData;
      }

      const res = await streamWait(YouTubeMusicTransport.postPlayer(payload, headers));

      if (!res.ok) {
        PlaybackLogger.warn(
          `[YouTubeMusic] Player API HTTP ${res.status} for ${cleanVid} after ${Date.now() - startMs}ms`,
        );
        if (!isRetry && (res.status === 401 || res.status === 403)) {
          return await streamWait(
            this.requestDirectAudioStream(cleanVid, true, forceRefresh, formatOptions),
          );
        }
        const failure = streamHttpFailure(res.status);
        if (failure) throw createStreamResolveError(failure);
        return '';
      }

      const json = await streamWait(res.json());
      const status = json?.playabilityStatus?.status;
      const reason = json?.playabilityStatus?.reason || '';
      if (status !== 'OK') {
        PlaybackLogger.warn(
          `[YouTubeMusic] Track ${cleanVid} playability status: ${status}${reason ? ` (${reason})` : ''} after ${Date.now() - startMs}ms`,
        );
        const accessCode = classifyYouTubeAudioAccessError(json.playabilityStatus);
        if (accessCode) {
          // Prefetch reports the challenge; active playback can attempt one session reset.
          if (epoch !== this.sessionEpoch) throw new Error(accessCode);
          const now = Date.now();
          for (const [id, failure] of this.audioAccessFailures) {
            if (failure.expiresAt <= now) this.audioAccessFailures.delete(id);
          }
          this.audioAccessFailures.delete(cleanVid);
          this.audioAccessFailures.set(cleanVid, {
            code: accessCode,
            expiresAt: now + this.AUDIO_ACCESS_FAILURE_TTL,
          });
          while (this.audioAccessFailures.size > 100)
            this.audioAccessFailures.delete(this.audioAccessFailures.keys().next().value!);
          throw new Error(accessCode);
        }
        if (!isRetry && !reason.includes('Music Premium') && status === 'UNPLAYABLE') {
          return await streamWait(
            this.requestDirectAudioStream(cleanVid, true, forceRefresh, formatOptions),
          );
        }
        console.warn(
          `[YouTubeMusicService] Player returned non-OK status: ${status}${reason ? ` (${reason})` : ''} for ${cleanVid}`,
        );
        return '';
      }

      if (json?.videoDetails?.videoId && json.videoDetails.videoId !== cleanVid) {
        PlaybackLogger.warn(
          '[YouTubeMusic:Identity] Player returned another recording; refusing playback for ' +
            cleanVid,
        );
        return '';
      }
      const providerLoudness = json?.playerConfig?.audioConfig?.loudnessDb;
      if (typeof providerLoudness === 'number' && Number.isFinite(providerLoudness)) {
        if (this.recordingGain.size >= 128)
          this.recordingGain.delete(this.recordingGain.keys().next().value!);
        this.recordingGain.set(cleanVid, Math.max(-24, Math.min(18, -providerLoudness)));
      }
      const lenSec = parseInt(json?.videoDetails?.lengthSeconds, 10);
      if (lenSec > 0 && epoch === this.sessionEpoch) {
        this.videoDurationCache.set(cleanVid, lenSec);
      }

      const formats: any[] = [
        ...(json?.streamingData?.adaptiveFormats || []),
        ...(json?.streamingData?.formats || []),
      ];

      const audioFormats = formats.filter(
        (f) =>
          f &&
          typeof f.url === 'string' &&
          f.url.startsWith('http') &&
          (f.mimeType?.startsWith('audio/') || !f.fps),
      );

      if (audioFormats.length === 0) {
        PlaybackLogger.warn(
          `[YouTubeMusic] No direct audio streams found in response for ${cleanVid} after ${Date.now() - startMs}ms`,
        );
        return '';
      }

      const best = selectYouTubeAudioFormat(audioFormats, formatOptions);
      if (!best && formatOptions.preferAlternateFormat) {
        PlaybackLogger.warn(`[YouTubeMusic] No other audio format for ${cleanVid}`);
      }
      const bestStreamUrl = best?.url;
      if (bestStreamUrl) {
        if (epoch === this.sessionEpoch)
          this.streamCache.set(cleanVid, {
            url: bestStreamUrl,
            via: 'anonymous',
            expiresAt: Date.now() + this.STREAM_CACHE_TTL,
          });
        PlaybackLogger.info(
          `[YouTubeMusic] Stream resolved in ${Date.now() - startMs}ms for ${cleanVid} (itag=${best.itag || '?'}, mime=${best.mimeType?.split(';')[0] || '?'}, bitrate=${best.bitrate || best.audioBitrate || '?'})`,
        );
        this.logStreamRoute(cleanVid, 'miss');
        return bestStreamUrl;
      }
    } catch (e) {
      assertStreamResolveActive();
      if (getYouTubeAudioAccessError(e)) {
        if (accountDeliveryRejected && getYouTubeAudioAccessError(e) !== 'age-restricted') {
          this.audioAccessFailures.delete(cleanVid);
          PlaybackLogger.warn(
            '[YouTubeMusic] Connected account media was rejected; an anonymous challenge does not mean the account needs another login',
          );
          throw createStreamResolveError('provider');
        }
        throw e;
      }
      PlaybackLogger.warn(
        `[YouTubeMusic] Network/API error resolving ${cleanVid} after ${Date.now() - startMs}ms:`,
        e,
      );
      console.warn('[YouTubeMusicService] resolveDirectAudioStream error:', e);
      const failure = getStreamResolveFailure(e) || streamTransportFailure(e);
      if (!isRetry && failure !== 'rate-limit') {
        return await streamWait(
          this.requestDirectAudioStream(cleanVid, true, forceRefresh, formatOptions),
        );
      }
      if (getStreamResolveFailure(e)) throw e;
      throw createStreamResolveError(failure);
    }

    return '';
  }

  /**
   * Resolves direct high-quality video stream URL (MP4) using VisionOS InnerTube client
   * Eliminates YouTube iframe embed error 150 and plays natively in HTML5 <video>
   */
  public static async resolveDirectVideoStream(
    videoId: string,
    isRetry = false,
    forceRefresh = false,
  ): Promise<string> {
    const cleanVid = this.cleanVideoId(videoId);
    if (!cleanVid) return '';
    const epoch = this.sessionEpoch,
      key = epoch + ':' + cleanVid;
    if (forceRefresh) this.videoStreamCache.delete(cleanVid);
    else {
      const cached = this.videoStreamCache.get(cleanVid);
      if (cached && Date.now() < cached.expiresAt) return cached.url;
      const pending = this.videoStreamRequests.get(key);
      if (pending) return pending;
    }
    let request!: Promise<string>;
    request = (async () => {
      const url = await this.requestDirectVideoStream(cleanVid, isRetry);
      // A forced retry or account change supersedes the old request, including its cache writes.
      if (epoch !== this.sessionEpoch || this.videoStreamRequests.get(key) !== request) return '';
      if (url)
        this.videoStreamCache.set(cleanVid, { url, expiresAt: Date.now() + this.STREAM_CACHE_TTL });
      return url;
    })().finally(() => {
      if (this.videoStreamRequests.get(key) === request) this.videoStreamRequests.delete(key);
    });
    this.videoStreamRequests.set(key, request);
    return request;
  }

  /** A resolved WEB address may still be denied by the CDN (e.g. missing stream attestation). */
  private static async checkAccountVideoUrl(url: string): Promise<boolean> {
    return this.checkAccountMediaUrl(url, 'video');
  }

  private static async checkAccountMediaUrl(
    url: string,
    kind: 'audio' | 'video',
  ): Promise<boolean> {
    assertStreamResolveActive();
    return (await streamWait(probeYouTubeMedia(url, kind))).ok;
  }

  private static async requestDirectVideoStream(
    videoId: string,
    isRetry: boolean = false,
  ): Promise<string> {
    if (!videoId) return '';
    const cleanVid = videoId.replace(/^yt_/, '').trim();
    if (!cleanVid) return '';

    const epoch = this.sessionEpoch;

    try {
      if (this.accountVideoResolver) {
        try {
          const stream = await this.accountVideoResolver(cleanVid);
          if (epoch !== this.sessionEpoch) return '';
          if (stream?.url) {
            const playable =
              stream.deliveryVerified || (await this.checkAccountVideoUrl(stream.url));
            if (epoch !== this.sessionEpoch) return '';
            if (playable) {
              PlaybackLogger.info(
                '[YouTubeMusic:VideoRoute] clip=' + cleanVid + ' via=account client=WEB',
              );
              return stream.url;
            }
            PlaybackLogger.warn(
              '[YouTubeMusic:VideoRoute] clip=' +
                cleanVid +
                ' account CDN rejected; trying anonymous route',
            );
          }
        } catch (error) {
          if (epoch !== this.sessionEpoch) return '';
          if (getYouTubeAudioAccessError(error) === 'age-restricted')
            throw new Error(VIDEO_AGE_RESTRICTED);
          PlaybackLogger.warn(
            '[YouTubeMusic] Account clip unavailable; trying anonymous playback for ' + cleanVid,
          );
        }
      }
      const visitorData = await this.getVisitorData(isRetry);

      const payload = {
        context: {
          client: {
            clientName: 'VISIONOS',
            clientVersion: '1.02',
            hl: 'en',
            gl: 'US',
            osName: 'visionOS',
            osVersion: '26.5.23O471',
            deviceMake: 'Apple',
            deviceModel: 'RealityDevice17,1',
            ...(visitorData ? { visitorData } : {}),
          },
          user: { lockedSafetyMode: false },
        },
        videoId: cleanVid,
        contentCheckOk: true,
        racyCheckOk: true,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
        'X-Goog-Api-Format-Version': '1',
        'X-YouTube-Client-Name': '101',
        'X-YouTube-Client-Version': '1.02',
      };
      if (visitorData) {
        headers['X-Goog-Visitor-Id'] = visitorData;
      }

      const res = await YouTubeMusicTransport.postPlayer(payload, headers);

      if (!res.ok) {
        if (!isRetry && (res.status === 401 || res.status === 403)) {
          return await this.requestDirectVideoStream(cleanVid, true);
        }
        return '';
      }

      const json = await res.json();
      const status = json?.playabilityStatus?.status;
      if (isAgeRestrictedVideo(json?.playabilityStatus)) {
        PlaybackLogger.warn(`[YouTubeMusic] Clip ${cleanVid} requires age verification`);
        throw new Error(VIDEO_AGE_RESTRICTED);
      }
      if (status !== 'OK') {
        if (!isRetry && (status === 'UNPLAYABLE' || status === 'LOGIN_REQUIRED')) {
          return await this.requestDirectVideoStream(cleanVid, true);
        }
        const access = classifyYouTubeAudioAccessError(json?.playabilityStatus);
        if (access)
          throw new Error(access.includes('BOT_CHECK') ? VIDEO_BOT_CHECK : VIDEO_LOGIN_REQUIRED);
        return '';
      }

      const formats: any[] = [
        ...(json?.streamingData?.formats || []),
        ...(json?.streamingData?.adaptiveFormats || []),
      ];

      // Filter for valid direct video mp4 formats
      const videoFormats = formats.filter(
        (f) =>
          f &&
          typeof f.url === 'string' &&
          f.url.startsWith('http') &&
          f.mimeType?.startsWith('video/mp4'),
      );

      if (videoFormats.length === 0) {
        const anyVideo = formats.filter(
          (f) =>
            f &&
            typeof f.url === 'string' &&
            f.url.startsWith('http') &&
            f.mimeType?.startsWith('video/'),
        );
        if (anyVideo.length > 0) {
          const chosen = anyVideo[0].url;
          return chosen;
        }
        return '';
      }

      // Sort by preferred resolution: closest to 720p (perfect for artwork preview box)
      videoFormats.sort((a, b) => {
        const heightA = a.height || parseInt(a.qualityLabel, 10) || 0;
        const heightB = b.height || parseInt(b.qualityLabel, 10) || 0;
        const target = 720;
        return Math.abs(heightA - target) - Math.abs(heightB - target);
      });

      PlaybackLogger.info(
        '[YouTubeMusic:VideoRoute] clip=' + cleanVid + ' via=anonymous client=VISIONOS',
      );
      const bestStreamUrl = videoFormats[0].url;
      if (bestStreamUrl) {
        return bestStreamUrl;
      }
    } catch (e) {
      if (getVideoPlaybackError(e) !== 'unavailable') throw e;
      console.warn('[YouTubeMusicService] resolveDirectVideoStream error:', e);
    }

    return '';
  }

  private static consecutiveFailures = 0;
  private static lastFailureTime = 0;
  private static CIRCUIT_BREAKER_COOLDOWN = 30 * 1000;
  private static INNERTUBE_TIMEOUT_MS = 5000;

  /**
   * Resolves dynamic language & country context for Innertube WEB_REMIX
   */
  private static getClientContext() {
    let hl = 'ru';
    let gl = 'US'; // gl: US ensures YouTube Music API is not geo-blocked
    try {
      const lang =
        (typeof navigator !== 'undefined' && navigator.language) ||
        (typeof process !== 'undefined' && (process.env.LANG || process.env.LC_ALL)) ||
        (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().locale) ||
        'ru';
      if (lang) {
        const parts = lang.split(/[-_.]/);
        // C/POSIX locales are process settings, not YouTube language codes.
        if (/^[a-z]{2,3}$/i.test(parts[0]) && parts[0].toLowerCase() !== 'und')
          hl = parts[0].toLowerCase();
        // Avoid RU country code on YouTube Music endpoints as it returns 403 / region disabled
        if (parts[1] && /^[a-z]{2}$/i.test(parts[1]) && parts[1].toUpperCase() !== 'RU') {
          gl = parts[1].toUpperCase();
        }
      }
    } catch {
      hl = 'ru';
      gl = 'US';
    }
    return {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20250910.01.00',
        hl,
        gl,
      },
    };
  }

  /**
   * Posts to music.youtube.com/youtubei/v1 using WEB_REMIX client context (ytmusicapi architecture)
   */
  private static async postInnertube(path: string, body: any, signal?: AbortSignal): Promise<any> {
    assertStreamResolveActive();
    signal?.throwIfAborted();
    if (
      this.consecutiveFailures >= 4 &&
      Date.now() - this.lastFailureTime < this.CIRCUIT_BREAKER_COOLDOWN
    ) {
      console.warn(
        `[YouTubeMusicService] Circuit breaker active (${this.consecutiveFailures} consecutive failures). Skipping request to ${path}`,
      );
      return null;
    }

    try {
      const res = await streamWait(
        YouTubeMusicTransport.postMusic(path, body, this.INNERTUBE_TIMEOUT_MS, signal),
      );
      if (res.ok) {
        const json = await streamWait(res.json());
        this.consecutiveFailures = 0;
        return json;
      }
      await streamWait(res.body?.cancel().catch(() => {}));
      PlaybackLogger.warn('[YouTubeMusic:API] endpoint=' + path + ' status=' + res.status);
      this.consecutiveFailures++;
      this.lastFailureTime = Date.now();
    } catch (e) {
      assertStreamResolveActive();
      signal?.throwIfAborted();
      this.consecutiveFailures++;
      this.lastFailureTime = Date.now();
      console.warn(`[YouTubeMusicService] postInnertube error:`, e);
    }

    return null;
  }

  public static isDurationAcceptable(
    targetDuration: number,
    candidateDuration: number,
    toleranceSec: number = 15,
  ): boolean {
    return isDurationClose(targetDuration, candidateDuration, toleranceSec);
  }

  public static extractAlbumFromFlexColumns(flexColumns: any[]): {
    albumTitle: string;
    albumBrowseId?: string;
  } {
    return extractAlbumFromFlexColumns(flexColumns);
  }

  public static parseShelfItem(r: any): Track | null {
    return parseInnerTubeShelfItem(r);
  }

  /**
   * Search official tracks on YouTube Music (WEB_REMIX protocol)
   */
  public static async search(
    query: string,
    limit: number = 25,
    signal?: AbortSignal,
  ): Promise<{ data: Track[]; total: number }> {
    assertStreamResolveActive();
    signal?.throwIfAborted();
    if (!query || !query.trim()) {
      return { data: [], total: 0 };
    }

    const cleanQ = query.trim();
    const cacheKey = `${cleanQ.toLowerCase()}_${limit}`;
    if (this.searchCache.has(cacheKey)) {
      return this.searchCache.get(cacheKey)!;
    }

    try {
      const clientContext = this.getClientContext();

      const tracks: Track[] = [];
      let receivedSearchResponse = false;
      let failedSearchResponse = false;
      const seenIds = new Set<string>();

      const parseShelfItems = (shelf: any) => {
        if (!shelf?.contents) return;
        for (const item of shelf.contents) {
          const r = item.musicResponsiveListItemRenderer;
          if (!r) continue;
          const track = YouTubeMusicService.parseShelfItem(r);
          if (!track) continue;
          const videoId = String(track.id).replace(/^yt_/, '');
          if (seenIds.has(videoId)) continue;
          seenIds.add(videoId);

          // Priority for official studio audio release (MUSIC_VIDEO_TYPE_ATV)
          const videoType =
            r.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs
              ?.watchEndpointMusicConfig?.musicVideoType;
          if (videoType === 'MUSIC_VIDEO_TYPE_ATV') {
            tracks.unshift(track);
          } else {
            tracks.push(track);
          }
          if (tracks.length >= limit) break;
        }
      };

      // 1. Fetch official Songs filter first (guarantees studio tracks)
      const songsJson = await streamWait(
        this.postInnertube(
          '/youtubei/v1/search',
          {
            context: clientContext,
            query: cleanQ,
            params: this.PARAMS.SONGS,
          },
          signal,
        ),
      );

      receivedSearchResponse ||= !!songsJson?.contents;
      failedSearchResponse ||= !songsJson?.contents;
      const sectionList =
        songsJson?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.sectionListRenderer?.contents || [];

      for (const s of sectionList) {
        if (s.musicShelfRenderer) {
          parseShelfItems(s.musicShelfRenderer);
        } else if (s.itemSectionRenderer?.contents) {
          for (const c of s.itemSectionRenderer.contents) {
            if (c.musicResponsiveListItemRenderer) {
              parseShelfItems({ contents: [c] });
            } else if (c.musicShelfRenderer) {
              parseShelfItems(c.musicShelfRenderer);
            }
          }
        }
      }

      // 2. If songs filter was below requested limit, fetch official Videos filter
      if (tracks.length < limit) {
        const videosJson = await streamWait(
          this.postInnertube(
            '/youtubei/v1/search',
            {
              context: clientContext,
              query: cleanQ,
              params: this.PARAMS.VIDEOS,
            },
            signal,
          ),
        );

        receivedSearchResponse ||= !!videosJson?.contents;
        failedSearchResponse ||= !videosJson?.contents;
        const vSectionList =
          videosJson?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
            ?.sectionListRenderer?.contents || [];

        for (const s of vSectionList) {
          if (s.musicShelfRenderer) {
            parseShelfItems(s.musicShelfRenderer);
          } else if (s.itemSectionRenderer?.contents) {
            for (const c of s.itemSectionRenderer.contents) {
              if (c.musicResponsiveListItemRenderer) {
                parseShelfItems({ contents: [c] });
              } else if (c.musicShelfRenderer) {
                parseShelfItems(c.musicShelfRenderer);
              }
            }
          }
          if (tracks.length >= limit) break;
        }
      }

      // 3. If results are still sparse, fallback to generic search and parse Top Card + standard shelves
      if (tracks.length < 5) {
        const genericJson = await streamWait(
          this.postInnertube(
            '/youtubei/v1/search',
            {
              context: clientContext,
              query: cleanQ,
            },
            signal,
          ),
        );

        receivedSearchResponse ||= !!genericJson?.contents;
        failedSearchResponse ||= !genericJson?.contents;
        const genSections =
          genericJson?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
            ?.sectionListRenderer?.contents || [];

        for (const s of genSections) {
          // Top Match Card (musicCardShelfRenderer)
          if (s.musicCardShelfRenderer) {
            const card = s.musicCardShelfRenderer;
            const title = card.title?.runs?.map((r: any) => r.text).join('') || '';
            const videoId = card.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
            const subtitleRuns = card.subtitle?.runs || [];

            const { artistName: extractedCardArtist } = extractArtistsFromRuns(subtitleRuns);
            let artistName = extractedCardArtist !== 'Unknown Artist' ? extractedCardArtist : '';
            let durationSec = 180;

            for (const run of subtitleRuns) {
              if (/^\d+:\d+(:\d+)?$/.test(String(run.text || '').trim())) {
                durationSec = parseDuration(String(run.text).trim());
                break;
              }
            }

            if (!artistName && subtitleRuns.length >= 3) {
              artistName = subtitleRuns[2]?.text || '';
            }

            const thumbs = card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
            const rawThumb = thumbs.slice(-1)[0]?.url || '';
            const hdCover = rawThumb
              ? rawThumb.replace(/=w\d+-h\d+[^?&]*/, '=w544-h544-l90-rj')
              : videoId
                ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
                : '';

            if (videoId && !seenIds.has(videoId)) {
              seenIds.add(videoId);
              tracks.unshift({
                id: `yt_${videoId}`,
                title,
                title_short: title,
                duration: durationSec,
                preview: `https://www.youtube.com/watch?v=${videoId}`,
                artist: {
                  id: `yt_art_${(artistName || 'Unknown').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '_')}`,
                  name: artistName || 'Unknown Artist',
                  picture_medium: hdCover,
                  source: 'youtube',
                },
                album: {
                  id: `yt_alb_${videoId}`,
                  title: 'Single',
                  cover: hdCover,
                  cover_small: hdCover,
                  cover_medium: hdCover,
                  cover_big: hdCover,
                  cover_xl: hdCover,
                },
                cover_url: hdCover,
                resolvedStreamUrl: '',
                source: 'youtube',
              });
            }

            // Also parse items inside card if artist card
            if (card.contents) {
              parseShelfItems({ contents: card.contents });
            }
          }

          if (s.musicShelfRenderer) {
            parseShelfItems(s.musicShelfRenderer);
          } else if (s.itemSectionRenderer?.contents) {
            for (const c of s.itemSectionRenderer.contents) {
              if (c.musicResponsiveListItemRenderer) {
                parseShelfItems({ contents: [c] });
              } else if (c.musicShelfRenderer) {
                parseShelfItems(c.musicShelfRenderer);
              }
            }
          }
        }
      }

      const result = { data: tracks.slice(0, limit), total: tracks.length };
      if (this.searchCache.size >= 300) {
        const oldest = this.searchCache.keys().next().value;
        if (oldest !== undefined) this.searchCache.delete(oldest);
      }
      // Keep real empty searches, but never cache a network/provider failure indefinitely.
      if (receivedSearchResponse && (!failedSearchResponse || result.data.length))
        this.searchCache.set(cacheKey, result);
      return result;
    } catch (e) {
      assertStreamResolveActive();
      signal?.throwIfAborted();
      console.warn('[YouTubeMusicService] Search error:', e);
      return { data: [], total: 0 };
    }
  }

  /**
   * Resolves clean direct audio stream URL for a YouTube track.
   * Leverages Kopuz VisionOS InnerTube player to stream Opus (itag 251) or AAC (itag 140)
   * directly without any offscreen browser windows or signatureCipher decryption.
   */
  public static async getFullStreamUrl(
    track: Track,
    options: StreamResolveOptions = {},
  ): Promise<string> {
    assertStreamResolveActive();
    if (!track) return '';

    // Extract videoId from track ID or preview URL
    let videoId = '';
    const idStr = String(track.id || '').trim();
    if (idStr.startsWith('yt_') && !idStr.startsWith('yt_art_') && !idStr.startsWith('yt_alb_')) {
      videoId = idStr.replace(/^yt_/, '').trim();
    } else if (track.preview) {
      const match = track.preview.match(/(?:v=|\/embed\/|\/watch\?v=|\.be\/)([^&?#/]+)/);
      if (match) videoId = match[1];
    }

    if (videoId) {
      const stream = await streamWait(
        this.resolveDirectAudioStream(videoId, false, options.forceRefresh, options),
      );
      if (stream) {
        const cachedDur = this.videoDurationCache.get(videoId);
        if (cachedDur && (!track.duration || track.duration === 180)) {
          track.duration = cachedDur;
        }
        return stream;
      }
    }

    return '';
  }

  /**
   * Fast official artist search on YouTube Music using PARAMS.ARTISTS
   */
  public static async searchArtists(query: string, limit: number = 6): Promise<{ data: Artist[] }> {
    assertStreamResolveActive();
    if (!query || !query.trim()) return { data: [] };
    const cleanQ = query.trim();

    try {
      const clientContext = this.getClientContext();
      const json = await this.postInnertube('/youtubei/v1/search', {
        context: clientContext,
        query: cleanQ,
        params: this.PARAMS.ARTISTS,
      });

      const sectionList =
        json?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.sectionListRenderer?.contents || [];

      const artists: Artist[] = [];
      const seenBrowseIds = new Set<string>();

      for (const section of sectionList) {
        const shelf = section.musicShelfRenderer || section.itemSectionRenderer;
        const contents = shelf?.contents || [];

        for (const item of contents) {
          const r = item.musicResponsiveListItemRenderer;
          if (!r) continue;

          const name =
            r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
          const browseId =
            r.navigationEndpoint?.browseEndpoint?.browseId ||
            r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
              ?.navigationEndpoint?.browseEndpoint?.browseId;

          if (!name || !browseId || seenBrowseIds.has(browseId)) continue;
          seenBrowseIds.add(browseId);

          const thumbs =
            r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
            r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
            [];
          const rawThumb = thumbs.slice(-1)[0]?.url || '';
          const hdPic = rawThumb ? rawThumb.replace(/=w\d+-h\d+[^?&]*/, '=w544-h544-l90-rj') : '';

          artists.push({
            id: `yt_art_${browseId}`,
            name,
            picture: hdPic,
            picture_medium: hdPic,
            picture_big: hdPic,
            picture_xl: hdPic,
            source: 'youtube',
          });

          if (artists.length >= limit) break;
        }
        if (artists.length >= limit) break;
      }

      return { data: artists };
    } catch (e) {
      console.warn('[YouTubeMusicService] searchArtists error:', e);
      assertStreamResolveActive();
      return { data: [] };
    }
  }

  /** Search official releases directly so album-name queries work in autocomplete. */
  public static async searchAlbums(query: string, limit: number = 5): Promise<Album[]> {
    if (!query || query.trim().length < 2) return [];
    const cleanQ = query.trim();

    try {
      const json = await this.postInnertube('/youtubei/v1/search', {
        context: this.getClientContext(),
        query: cleanQ,
        params: this.PARAMS.ALBUMS,
      });
      return parseAlbumSearchResults(json, limit);
    } catch (e) {
      console.warn('[YouTubeMusicService] searchAlbums error:', e);
      return [];
    }
  }

  /**
   * Get artist details, top tracks, and full official albums from YouTube Music
   */
  public static async getArtist(
    idOrName: string | number,
    expectedArtistName?: string,
  ): Promise<ArtistDetails | null> {
    const rawStr = String(idOrName || '').trim();
    const strippedId = rawStr
      .replace(/^yt_art_/i, '')
      .replace(/^yt_/i, '')
      .replace(/^sc_art_/i, '')
      .replace(/^sc_/i, '')
      .trim();

    let artistBrowseId: string | null = null;
    if (strippedId.startsWith('UC') && strippedId.length >= 20) {
      artistBrowseId = strippedId;
    } else if (rawStr.startsWith('UC') && rawStr.length >= 20) {
      artistBrowseId = rawStr;
    }

    const cleanName = (
      expectedArtistName ||
      (artistBrowseId ? '' : strippedId.replace(/_/g, ' ').trim()) ||
      rawStr
    ).trim();

    // Numeric IDs are SoundCloud user IDs, never query YouTube for pure numbers
    if (!artistBrowseId && (!cleanName || /^\d+$/.test(cleanName))) {
      return null;
    }

    try {
      const clientContext = this.getClientContext();

      let fallbackCover = '';
      let topTracks: Track[] = [];

      // 1. If we don't have browse ID, search specifically for the artist using PARAMS.ARTISTS
      if (!artistBrowseId) {
        const foundArtists = await this.searchArtists(cleanName, 3);
        if (foundArtists?.data && foundArtists.data.length > 0) {
          const cleanLower = cleanName.toLowerCase();
          const exact =
            foundArtists.data.find(
              (a) => a.name.toLowerCase() === cleanLower || isArtistMatch({ artist: a }, cleanName),
            ) || foundArtists.data[0];
          if (exact?.id) {
            const bId = String(exact.id)
              .replace(/^yt_art_/, '')
              .trim();
            if (bId.startsWith('UC')) {
              artistBrowseId = bId;
              fallbackCover = exact.picture_big || exact.picture_medium || exact.picture || '';
            }
          }
        }
      }

      // 1b. If still not found, check generic search card as secondary fallback
      if (!artistBrowseId) {
        const genericJson = await this.postInnertube('/youtubei/v1/search', {
          context: clientContext,
          query: cleanName,
        });

        if (genericJson) {
          const sections =
            genericJson?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
              ?.sectionListRenderer?.contents || [];

          for (const s of sections) {
            if (s.musicCardShelfRenderer) {
              const card = s.musicCardShelfRenderer;
              const cardBrowseId =
                card.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ||
                card.onTap?.browseEndpoint?.browseId;
              if (cardBrowseId && cardBrowseId.startsWith('UC')) {
                artistBrowseId = cardBrowseId;
              }
              const thumbs = card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
              if (thumbs.length > 0) {
                fallbackCover = thumbs.slice(-1)[0]?.url || '';
              }
            }
          }
        }
      }

      // 2. If artist browse ID is found, fetch the full official artist page
      if (artistBrowseId) {
        const artistPage = await this.postInnertube('/youtubei/v1/browse', {
          context: clientContext,
          browseId: artistBrowseId,
        });

        const header =
          artistPage?.header?.musicImmersiveHeaderRenderer ||
          artistPage?.header?.musicVisualHeaderRenderer ||
          artistPage?.header?.musicHeaderRenderer;

        const resolvedArtistName = header?.title?.runs?.[0]?.text || cleanName;
        const headerThumbs =
          header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
          header?.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
          [];
        const artistPicture = headerThumbs.slice(-1)[0]?.url || fallbackCover;

        const albums: any[] = [];
        const seenAlbumIds = new Set<string>();

        const tabs =
          artistPage?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
            ?.sectionListRenderer?.contents || [];

        for (const sec of tabs) {
          const shelf = sec.musicShelfRenderer || sec.musicCarouselShelfRenderer;
          if (!shelf) continue;

          const shelfTitle = (
            shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text ||
            shelf.header?.musicShelfBasicHeaderRenderer?.title?.runs?.[0]?.text ||
            ''
          ).toLowerCase();

          const items = shelf.contents || [];

          const isAlbumOrRelease =
            shelfTitle.includes('альбом') ||
            shelfTitle.includes('сингл') ||
            shelfTitle.includes('album') ||
            shelfTitle.includes('single') ||
            shelfTitle.includes('ep') ||
            shelfTitle.includes('релиз') ||
            shelfTitle.includes('release');

          const isSongShelf =
            shelfTitle.includes('трек') ||
            shelfTitle.includes('песн') ||
            shelfTitle.includes('song') ||
            shelfTitle.includes('track') ||
            shelfTitle.includes('popular') ||
            shelfTitle.includes('лучш');

          // Top Songs shelf (ensure album shelves are never misclassified as songs)
          if (
            isSongShelf ||
            (!isAlbumOrRelease &&
              topTracks.length === 0 &&
              !shelfTitle.includes('похож') &&
              !shelfTitle.includes('video') &&
              !shelfTitle.includes('видео'))
          ) {
            let songItems = items;

            // If a "View All" playlist exists for top songs (VL... or OLAK5uy_...), fetch it
            // InnerTube includes exact fixedColumns duration in the full playlist view for all artists
            const bottomBrowseId = shelf.bottomEndpoint?.browseEndpoint?.browseId;
            const bottomParams = shelf.bottomEndpoint?.browseEndpoint?.params;
            if (
              bottomBrowseId &&
              (bottomBrowseId.startsWith('VL') || bottomBrowseId.startsWith('OLAK5uy_'))
            ) {
              try {
                const plJson = await this.postInnertube('/youtubei/v1/browse', {
                  context: clientContext,
                  browseId: bottomBrowseId,
                  ...(bottomParams ? { params: bottomParams } : {}),
                });
                const plShelf =
                  plJson?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
                    ?.content?.sectionListRenderer?.contents?.[0]?.musicPlaylistShelfRenderer ||
                  plJson?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents
                    ?.sectionListRenderer?.contents?.[0]?.musicPlaylistShelfRenderer;
                if (plShelf?.contents && plShelf.contents.length > 0) {
                  songItems = plShelf.contents;
                }
              } catch (err) {
                console.warn(
                  '[YouTubeMusicService] Failed to fetch artist top tracks playlist:',
                  err,
                );
              }
            }

            for (const it of songItems) {
              const r = it.musicResponsiveListItemRenderer || it.musicTwoRowItemRenderer;
              if (!r) continue;

              const title = (
                r.title?.runs ||
                r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
                []
              )
                .map((x: any) => x.text)
                .join('')
                .trim();
              const videoId =
                r.playlistItemData?.videoId ||
                r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
                  ?.playNavigationEndpoint?.watchEndpoint?.videoId ||
                r.navigationEndpoint?.watchEndpoint?.videoId;

              if (!title || !videoId) continue;

              const thumbs =
                r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
                r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
                [];
              const rawThumb = thumbs.slice(-1)[0]?.url || '';
              const hdCover = rawThumb
                ? rawThumb.replace(/=w\d+-h\d+[^?&]*/, '=w544-h544-l90-rj')
                : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

              let durSec = 180;
              const fixedCol =
                r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text;
              const fixedText = fixedCol?.runs?.[0]?.text || fixedCol?.simpleText;
              if (fixedText) {
                durSec = parseDuration(fixedText);
              } else if (Array.isArray(r.flexColumns)) {
                for (let colIdx = r.flexColumns.length - 1; colIdx >= 0; colIdx--) {
                  const runs =
                    r.flexColumns[colIdx]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
                    [];
                  for (let j = runs.length - 1; j >= 0; j--) {
                    const run = runs[j];
                    const t = String(run?.text || '').trim();
                    if (/^\d+:\d+(:\d+)?$/.test(t)) {
                      durSec = parseDuration(t);
                      break;
                    }
                  }
                  if (durSec !== 180) break;
                }
              }

              if (durSec > 0 && durSec !== 180) {
                this.videoDurationCache.set(videoId, durSec);
              }

              // Extract real album name from flexColumns
              let albumTitle = 'Single';
              let albumBrowseId = videoId;
              if (Array.isArray(r.flexColumns)) {
                for (let i = 1; i < r.flexColumns.length; i++) {
                  const runs =
                    r.flexColumns[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
                  for (const run of runs) {
                    const bId = run.navigationEndpoint?.browseEndpoint?.browseId;
                    if (
                      bId &&
                      (bId.startsWith('MPREb_') ||
                        bId.startsWith('FEmusic_library_privately_owned_release_detail'))
                    ) {
                      albumTitle = run.text;
                      albumBrowseId = bId;
                      break;
                    }
                  }
                  if (albumTitle !== 'Single') break;
                }
                if (albumTitle === 'Single' && r.flexColumns.length >= 3) {
                  for (let i = 2; i < r.flexColumns.length; i++) {
                    const text =
                      r.flexColumns[
                        i
                      ]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text?.trim();
                    if (
                      text &&
                      !/^\d+[\s,.\d]*\s*(прослуш|просмотр|views|plays|млн|тыс)/i.test(text) &&
                      !/^\d+:\d+/.test(text)
                    ) {
                      albumTitle = text;
                      break;
                    }
                  }
                }
              }

              const artistRuns =
                r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
                r.subtitle?.runs ||
                [];
              const { artistName: extractedArtist, artistBrowseId: extractedBrowseId } =
                extractArtistsFromRuns(artistRuns);
              let trackArtistName = resolvedArtistName;
              if (extractedArtist && extractedArtist !== 'Unknown Artist') {
                if (
                  extractedArtist.toLowerCase().startsWith('feat') ||
                  extractedArtist.toLowerCase().startsWith('ft') ||
                  extractedArtist.toLowerCase().startsWith('при уч')
                ) {
                  trackArtistName = `${resolvedArtistName} ${extractedArtist}`;
                } else {
                  trackArtistName = extractedArtist;
                }
              }

              topTracks.push({
                id: `yt_${videoId}`,
                title,
                title_short: title,
                duration: durSec,
                preview: `https://www.youtube.com/watch?v=${videoId}`,
                artist: {
                  id: `yt_art_${extractedBrowseId || artistBrowseId}`,
                  name: trackArtistName,
                  picture_medium: artistPicture,
                  source: 'youtube',
                },
                album: {
                  id: `yt_alb_${albumBrowseId}`,
                  title: albumTitle,
                  cover: hdCover,
                  cover_small: hdCover,
                  cover_medium: hdCover,
                  cover_big: hdCover,
                  cover_xl: hdCover,
                },
                cover_url: hdCover,
                resolvedStreamUrl: '',
                source: 'youtube',
              });
            }
          }

          // Albums and Singles shelves
          if (isAlbumOrRelease) {
            for (const it of items) {
              const r = it.musicTwoRowItemRenderer || it.musicResponsiveListItemRenderer;
              if (!r) continue;

              const albumTitle = (
                r.title?.runs ||
                r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
                []
              )
                .map((x: any) => x.text)
                .join('')
                .trim();
              const browseId =
                r.navigationEndpoint?.browseEndpoint?.browseId ||
                r.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ||
                r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
                  ?.navigationEndpoint?.browseEndpoint?.browseId;

              if (!albumTitle || !browseId || seenAlbumIds.has(browseId)) continue;
              seenAlbumIds.add(browseId);

              const thumbs =
                r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
                r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
                [];
              const rawThumb = thumbs.slice(-1)[0]?.url || '';
              const hdCover = rawThumb
                ? rawThumb.replace(/=w\d+-h\d+[^?&]*/, '=w544-h544-l90-rj')
                : artistPicture;

              const subText = (
                r.subtitle?.runs ||
                r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
                []
              )
                .map((x: any) => x.text)
                .join(' • ');
              const yearMatch = subText.match(/\b(19\d\d|20\d\d)\b/);
              const releaseDate = yearMatch ? yearMatch[1] : '';

              albums.push({
                id: `yt_alb_${browseId}`,
                title: albumTitle,
                cover: hdCover,
                cover_medium: hdCover,
                cover_big: hdCover,
                cover_xl: hdCover,
                release_date: releaseDate,
                record_type:
                  shelfTitle.includes('сингл') || shelfTitle.includes('single')
                    ? 'single'
                    : 'album',
                track_count: 0,
                artist_name: resolvedArtistName,
                artist: {
                  id: `yt_art_${artistBrowseId}`,
                  name: resolvedArtistName,
                  picture_url: artistPicture,
                },
                source: 'youtube',
              });
            }
          }
        }

        return {
          artist: {
            id: `yt_art_${artistBrowseId}`,
            name: resolvedArtistName,
            picture: artistPicture,
            picture_medium: artistPicture,
            picture_big: artistPicture,
            picture_xl: artistPicture,
            nb_album: albums.length,
            nb_fan: 0,
            source: 'youtube',
          },
          topTracks: topTracks.slice(0, 30),
          albums,
        };
      }

      // 3. Fallback to search results if browse endpoint was not reachable
      const searchRes = await this.search(cleanName, 30);
      const tracks = searchRes.data || [];
      if (tracks.length === 0) return null;

      const firstTrack = tracks[0];
      const cover =
        firstTrack.album?.cover_big ||
        firstTrack.album?.cover_medium ||
        firstTrack.album?.cover ||
        '';

      return {
        artist: {
          id: `yt_art_${cleanName.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '_')}`,
          name: firstTrack.artist?.name || cleanName,
          picture: cover,
          picture_medium: cover,
          picture_big: cover,
          picture_xl: cover,
          source: 'youtube',
        },
        topTracks: tracks.slice(0, 20).map((t) => ({ ...t, source: 'youtube' })),
        albums: [],
      };
    } catch (e) {
      console.warn('[YouTubeMusicService] getArtist error:', e);
      return null;
    }
  }

  /**
   * Resolves an album's official InnerTube browseId (MPREb_*) via PARAMS.ALBUMS search
   */
  public static async resolveAlbumBrowseId(
    albumTitle: string,
    artistName?: string,
  ): Promise<string | null> {
    if (!albumTitle || albumTitle === 'Single') return null;
    const cleanTitle = albumTitle.trim();
    const cleanArtist = (artistName || '').trim();
    const query = cleanArtist ? `${cleanTitle} ${cleanArtist}` : cleanTitle;

    try {
      const json = await this.postInnertube('/youtubei/v1/search', {
        context: this.getClientContext(),
        query,
        params: this.PARAMS.ALBUMS,
      });

      const sectionList =
        json?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.sectionListRenderer?.contents || [];

      for (const section of sectionList) {
        const shelf = section.musicShelfRenderer || section.itemSectionRenderer;
        const contents = shelf?.contents || [];
        for (const it of contents) {
          const r = it.musicResponsiveListItemRenderer;
          if (!r) continue;
          const browseId =
            r.navigationEndpoint?.browseEndpoint?.browseId ||
            r.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ||
            r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
              ?.navigationEndpoint?.browseEndpoint?.browseId;
          if (browseId && (browseId.startsWith('MPREb_') || browseId.startsWith('OLAK5uy_'))) {
            return browseId;
          }
        }
      }
    } catch (e) {
      console.warn('[YouTubeMusicService] resolveAlbumBrowseId error:', e);
    }
    return null;
  }

  /**
   * Get all tracks from a YouTube Music album
   */
  public static async getAlbumTracks(
    albumIdOrBrowseId?: string | number,
    albumTitle?: string,
    artistName?: string,
  ): Promise<Track[]> {
    if (!albumIdOrBrowseId && !albumTitle) return [];

    let rawId = String(albumIdOrBrowseId || '')
      .replace(/^(yt_alb_|yt_)/i, '')
      .trim();

    // If ID is not a real YouTube Music browse ID (MPREb_ or OLAK5uy_), resolve via ALBUMS filter
    if (
      !rawId.startsWith('MPREb_') &&
      !rawId.startsWith('OLAK5uy_') &&
      albumTitle &&
      albumTitle !== 'Single'
    ) {
      const resolvedBrowseId = await this.resolveAlbumBrowseId(albumTitle, artistName);
      if (resolvedBrowseId) {
        rawId = resolvedBrowseId;
      }
    }

    if (!rawId) return [];

    try {
      const albumPage = await this.postInnertube('/youtubei/v1/browse', {
        context: this.getClientContext(),
        browseId: rawId,
      });

      const twoCol = albumPage?.contents?.twoColumnBrowseResultsRenderer;
      const tabHeader =
        twoCol?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
          ?.musicResponsiveHeaderRenderer;
      const header =
        albumPage?.header?.musicDetailHeaderRenderer ||
        albumPage?.header?.musicResponsiveHeaderRenderer ||
        tabHeader;

      const resolvedAlbumTitle = header?.title?.runs?.[0]?.text || albumTitle || 'Album';
      const resolvedArtist =
        header?.straplineTextOne?.runs?.[0]?.text ||
        header?.subtitle?.runs?.find((r: any) =>
          r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'),
        )?.text ||
        artistName ||
        'Artist';

      const headerThumbs =
        header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
        albumPage?.header?.musicDetailHeaderRenderer?.thumbnail?.musicThumbnailRenderer?.thumbnail
          ?.thumbnails ||
        albumPage?.header?.musicImmersiveHeaderRenderer?.thumbnail?.musicThumbnailRenderer
          ?.thumbnail?.thumbnails ||
        tabHeader?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
        [];
      const rawThumb = headerThumbs.slice(-1)[0]?.url || '';
      const hdCover = rawThumb ? rawThumb.replace(/=w\d+-h\d+[^?&]*/, '=w544-h544-l90-rj') : '';

      const contents =
        twoCol?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer
          ?.contents ||
        albumPage?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer?.contents ||
        [];

      const tracks: Track[] = [];

      for (let i = 0; i < contents.length; i++) {
        const it = contents[i];
        const r = it.musicResponsiveListItemRenderer;
        if (!r) continue;

        const title = (
          r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []
        )
          .map((x: any) => x.text)
          .join('')
          .trim();
        const videoId =
          r.playlistItemData?.videoId ||
          r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
            ?.playNavigationEndpoint?.watchEndpoint?.videoId ||
          r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
            ?.navigationEndpoint?.watchEndpoint?.videoId;

        if (!title || !videoId) continue;

        let durSec = 180;
        const fixedCol = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text;
        const durText = fixedCol?.runs?.[0]?.text || fixedCol?.simpleText;
        if (durText) {
          durSec = parseDuration(durText);
        } else if (Array.isArray(r.flexColumns)) {
          for (let colIdx = r.flexColumns.length - 1; colIdx >= 0; colIdx--) {
            const runs =
              r.flexColumns[colIdx]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
            for (let j = runs.length - 1; j >= 0; j--) {
              const run = runs[j];
              const t = String(run?.text || '').trim();
              if (/^\d+:\d+(:\d+)?$/.test(t)) {
                durSec = parseDuration(t);
                break;
              }
            }
            if (durSec !== 180) break;
          }
        }

        if (durSec > 0 && durSec !== 180) {
          this.videoDurationCache.set(videoId, durSec);
        }

        const artistRuns =
          r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
          r.subtitle?.runs ||
          [];
        const { artistName: extractedArtist, artistBrowseId: extractedBrowseId } =
          extractArtistsFromRuns(artistRuns);
        let trackArtist = resolvedArtist;
        if (extractedArtist && extractedArtist !== 'Unknown Artist') {
          if (
            extractedArtist.toLowerCase().startsWith('feat') ||
            extractedArtist.toLowerCase().startsWith('ft') ||
            extractedArtist.toLowerCase().startsWith('при уч')
          ) {
            trackArtist = `${resolvedArtist} ${extractedArtist}`;
          } else {
            trackArtist = extractedArtist;
          }
        }

        tracks.push({
          id: `yt_${videoId}`,
          title,
          title_short: title,
          duration: durSec,
          preview: `https://www.youtube.com/watch?v=${videoId}`,
          artist: {
            id: `yt_art_${extractedBrowseId || (trackArtist || 'Unknown').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '_')}`,
            name: trackArtist,
            picture_medium: hdCover,
            source: 'youtube',
          },
          album: {
            id: `yt_alb_${rawId}`,
            title: resolvedAlbumTitle,
            cover: hdCover,
            cover_small: hdCover,
            cover_medium: hdCover,
            cover_big: hdCover,
            cover_xl: hdCover,
          },
          cover_url: hdCover,
          resolvedStreamUrl: '',
          source: 'youtube',
        });
      }

      return tracks;
    } catch (e) {
      console.warn('[YouTubeMusicService] getAlbumTracks error:', e);
      return [];
    }
  }

  /**
   * Get all tracks for an artist (top tracks + tracks from all albums)
   */
  public static async getArtistAllTracks(
    idOrName: string | number,
    artistName?: string,
  ): Promise<Track[]> {
    const cleanName = (artistName || String(idOrName))
      .replace(/^yt_art_/i, '')
      .replace(/^yt_/i, '')
      .replace(/^sc_art_/i, '')
      .replace(/^sc_/i, '')
      .replace(/_/g, ' ')
      .trim();

    try {
      const details = await this.getArtist(idOrName);
      if (!details) {
        const searchRes = await this.search(cleanName, 50);
        return (searchRes.data || []).map((t) => ({ ...t, source: 'youtube' }));
      }

      const allTracks: Track[] = [...(details.topTracks || [])];
      const seenVideoIds = new Set<string>();

      allTracks.forEach((t) => {
        const vid = String(t.id).replace(/^yt_/, '');
        seenVideoIds.add(vid);
      });

      // Fetch tracks from discovered albums in small batches (capped to top 10 albums to avoid rate limits)
      if (details.albums && details.albums.length > 0) {
        const targetAlbums = details.albums.slice(0, 10);
        for (let i = 0; i < targetAlbums.length; i += 3) {
          const batch = targetAlbums.slice(i, i + 3);
          const albumResults = await Promise.allSettled(
            batch.map((alb) => this.getAlbumTracks(alb.id, alb.title, details.artist.name)),
          );

          for (const res of albumResults) {
            if (res.status === 'fulfilled' && res.value?.length > 0) {
              for (const trk of res.value) {
                const vid = String(trk.id).replace(/^yt_/, '');
                const existingIdx = allTracks.findIndex(
                  (t) => String(t.id).replace(/^yt_/, '') === vid,
                );
                if (existingIdx !== -1) {
                  const existing = allTracks[existingIdx];
                  if (
                    (!existing.duration || existing.duration === 180) &&
                    trk.duration &&
                    trk.duration !== 180
                  ) {
                    existing.duration = trk.duration;
                  }
                  if (
                    (!existing.album?.title || existing.album.title === 'Single') &&
                    trk.album?.title &&
                    trk.album.title !== 'Single'
                  ) {
                    existing.album = trk.album;
                  }
                  if (details.topTracks) {
                    const topMatch = details.topTracks.find(
                      (t) => String(t.id).replace(/^yt_/, '') === vid,
                    );
                    if (topMatch) {
                      if (
                        (!topMatch.duration || topMatch.duration === 180) &&
                        trk.duration &&
                        trk.duration !== 180
                      ) {
                        topMatch.duration = trk.duration;
                      }
                      if (
                        (!topMatch.album?.title || topMatch.album.title === 'Single') &&
                        trk.album?.title &&
                        trk.album.title !== 'Single'
                      ) {
                        topMatch.album = trk.album;
                      }
                    }
                  }
                } else {
                  seenVideoIds.add(vid);
                  allTracks.push(trk);
                }
              }
            }
          }
        }
      }

      return allTracks;
    } catch (e) {
      console.warn('[YouTubeMusicService] getArtistAllTracks error:', e);
      return [];
    }
  }

  /**
   * Generates continuous Song Radio / Artist Radio via InnerTube Next watch playlist (from GooseOb/music_plr)
   */
  public static async getRadioTracks(
    videoId?: string,
    playlistId?: string,
    limit: number = 25,
    signal?: AbortSignal,
  ): Promise<Track[]> {
    signal?.throwIfAborted();
    const rawVid = (videoId || '').replace(/^yt_/, '');
    if (!rawVid && !playlistId) return [];

    const effectivePlaylistId = playlistId || `RDAMVM${rawVid}`;
    const clientContext = this.getClientContext();

    const body: any = {
      context: clientContext,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true,
    };
    if (rawVid) body.videoId = rawVid;
    if (effectivePlaylistId) body.playlistId = effectivePlaylistId;

    try {
      const json = await this.postInnertube('/youtubei/v1/next', body, signal);
      if (!json) return [];

      return parseYouTubeRadioResponse(json, limit);
    } catch (e) {
      signal?.throwIfAborted();
      console.warn('[YouTubeMusicService] getRadioTracks error:', e);
      return [];
    }
  }

  /**
   * Search specifically for the authentic official music video clip of a track.
   * Prioritizes MUSIC_VIDEO_TYPE_OMV, filters out audio-only (- Topic), karaoke, live, cover, and tabs.
   */
  /**
   * Search for official music video clip via Google YouTube Data API v3.
   * Enforces videoEmbeddable=true to ensure seamless iframe playback.
   */
  public static async searchViaYouTubeDataApi(
    artist: string,
    title: string,
    apiKey: string,
  ): Promise<string | null> {
    if (!apiKey || !apiKey.trim() || !title) return null;
    const cleanArtist = (artist || '').trim();
    const cleanTitle = (title || '').replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
    if (!cleanTitle) return null;

    try {
      const query = `${cleanArtist} ${cleanTitle} official video`.trim();
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=8&q=${encodeURIComponent(
        query,
      )}&key=${encodeURIComponent(apiKey.trim())}`;

      const res = await YouTubeMusicTransport.fetch(url);
      if (!res.ok) {
        console.warn(
          `[YouTubeMusicService] YouTube Data API v3 error: ${res.status} ${res.statusText}`,
        );
        return null;
      }

      const data = await res.json();
      const items = data.items || [];
      if (!Array.isArray(items) || items.length === 0) return null;

      const negativeKeywords = [
        'караоке',
        'karaoke',
        'minus',
        'минус',
        'минусовка',
        'instrumental',
        'инструментал',
        'guitar tab',
        'табы',
        'аккорды',
        'chords',
        'разбор',
        'tutorial',
        'как играть',
        'cover',
        'кавер',
        'reaction',
        'реакция',
        'remix',
        'ремикс',
        'bass boosted',
        'slowed',
        'reverb',
        '10 hours',
        '1 час',
        '10 часов',
        'hour loop',
        'speed up',
        'audio',
        'аудио',
        'lyric',
        'lyrics',
        'текст песни',
        'слова песни',
        'live',
        'концерт',
        'живой звук',
        'выступление',
        'acoustic version',
      ];
      const activeNegative = negativeKeywords.filter(
        (kw) => !cleanTitle.toLowerCase().includes(kw),
      );

      interface ApiCandidate {
        id: string;
        title: string;
        channel: string;
        score: number;
      }
      const candidates: ApiCandidate[] = [];

      for (const item of items) {
        const videoId = item.id?.videoId;
        if (!isValidYouTubeVideoId(videoId)) continue;

        const itemTitle = item.snippet?.title || '';
        const itemChannel = item.snippet?.channelTitle || '';
        const lowerTitle = itemTitle.toLowerCase();
        const lowerChannel = itemChannel.toLowerCase();

        if (containsAnyPhrase(lowerTitle, activeNegative)) continue;
        if (!isTitleMatch(itemTitle, cleanTitle)) continue;

        // The Data API doesn't expose YouTube Music's OMV/verified metadata.
        // Require an explicit official-video title or an established official label/channel.
        const hasOfficialSignal =
          /\bofficial\b|\bmusic video\b|клип/i.test(itemTitle) ||
          /\bvevo\b|\bofficial\b|\brecords\b/i.test(itemChannel);
        if (!hasOfficialSignal) continue;

        let score = 0;
        if (cleanArtist && lowerChannel.includes(cleanArtist.toLowerCase())) score += 50;
        if (
          lowerChannel.includes('vevo') ||
          lowerChannel.includes('official') ||
          lowerChannel.includes('records')
        )
          score += 30;
        if (lowerTitle.includes('official music video') || lowerTitle.includes('official video'))
          score += 40;
        else if (lowerTitle.includes('клип') || lowerTitle.includes('music video')) score += 25;
        else if (lowerTitle.includes('official')) score += 15;

        score += 30;

        candidates.push({
          id: videoId,
          title: itemTitle,
          channel: itemChannel,
          score,
        });
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0].id;
      }
    } catch (e) {
      console.warn('[YouTubeMusicService] searchViaYouTubeDataApi exception:', e);
    }
    return null;
  }

  /**
   * Search for an authentic official music video clip.
   * Checks YouTube Data API v3 first if API key is provided, then Innertube OMV stream.
   * Prioritizes MUSIC_VIDEO_TYPE_OMV, filters out audio-only (- Topic), karaoke, live, cover, and tabs.
   */
  public static async searchOfficialMusicVideo(
    artist: string,
    title: string,
    customApiKey?: string,
  ): Promise<string | null> {
    const cleanArtist = (artist || '').trim();
    const cleanTitle = (title || '').replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
    if (!cleanTitle) return null;

    // 0. If YouTube Data API v3 key is provided or configured, query it first
    const effectiveApiKey = (customApiKey || process.env.YOUTUBE_API_KEY || '').trim();
    if (effectiveApiKey) {
      const dataApiVid = await this.searchViaYouTubeDataApi(
        cleanArtist,
        cleanTitle,
        effectiveApiKey,
      );
      if (dataApiVid) {
        this.resolveDirectVideoStream(dataApiVid).catch(() => {});
        return dataApiVid;
      }
    }

    const query = `${cleanArtist} ${cleanTitle}`.trim();
    const clientContext = this.getClientContext();

    // Negative keywords: things that definitely are NOT official music video clips
    const negativeKeywords = [
      'караоке',
      'karaoke',
      'minus',
      'минус',
      'минусовка',
      'instrumental',
      'инструментал',
      'guitar tab',
      'табы',
      'аккорды',
      'chords',
      'разбор',
      'tutorial',
      'как играть',
      'cover',
      'кавер',
      'reaction',
      'реакция',
      'remix',
      'ремикс',
      'bass boosted',
      'slowed',
      'reverb',
      '10 hours',
      '1 час',
      '10 часов',
      'hour loop',
      'speed up',
      'audio',
      'аудио',
      'lyric',
      'lyrics',
      'текст песни',
      'слова песни',
      'live',
      'концерт',
      'живой звук',
      'выступление',
      'acoustic version',
    ];

    const activeNegative = negativeKeywords.filter((kw) => !cleanTitle.toLowerCase().includes(kw));

    const isNegative = (text: string): boolean => {
      return containsAnyPhrase(text, activeNegative);
    };

    try {
      // Query 1: YouTube Music VIDEOS filter (dedicated music video stream)
      const videosJson = await this.postInnertube('/youtubei/v1/search', {
        context: clientContext,
        query: `${query} official video`,
        params: this.PARAMS.VIDEOS,
      });

      const sectionList =
        videosJson?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.sectionListRenderer?.contents || [];

      interface Candidate {
        id: string;
        title: string;
        isOMV: boolean;
        hasVerifiedBadge: boolean;
        matchesArtist: boolean;
        hasOfficialKw: boolean;
        score: number;
      }

      const candidates: Candidate[] = [];

      const inspectItem = (r: any) => {
        if (!r) return;
        const watchEndpoint =
          r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
            ?.navigationEndpoint?.watchEndpoint ||
          r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
            ?.playNavigationEndpoint?.watchEndpoint ||
          r.navigationEndpoint?.watchEndpoint;

        const videoId =
          r.playlistItemData?.videoId ||
          watchEndpoint?.videoId ||
          r.videoId ||
          r.doubleTapCommand?.watchEndpoint?.videoId;
        if (!isValidYouTubeVideoId(videoId)) return;

        const flexCols = r.flexColumns || [];
        const itemTitle =
          flexCols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ||
          r.title?.runs?.[0]?.text ||
          '';

        const videoType =
          watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig
            ?.musicVideoType;

        // Skip static audio releases (MUSIC_VIDEO_TYPE_ATV is the album audio track, not a clip!)
        if (videoType === 'MUSIC_VIDEO_TYPE_ATV') return;

        const lowerTitle = itemTitle.toLowerCase();
        if (isNegative(lowerTitle)) return;

        // Enforce strict title matching: NEVER accept a video clip of a completely different song!
        if (!isTitleMatch(itemTitle, cleanTitle)) return;

        // YouTube Innertube explicit official music video flag
        const isOMV = videoType === 'MUSIC_VIDEO_TYPE_OMV';

        // Check for verified artist / official channel badges
        const hasVerifiedBadge = Boolean(
          r.ownerBadges?.some((b: any) => {
            const style = b.metadataBadgeRenderer?.style;
            const icon = b.metadataBadgeRenderer?.icon?.iconType;
            return (
              style === 'BADGE_STYLE_TYPE_VERIFIED_ARTIST' ||
              style === 'BADGE_STYLE_TYPE_VERIFIED' ||
              icon === 'OFFICIAL_ARTIST_BADGE' ||
              icon === 'CHECK_CIRCLE_THIN' ||
              icon === 'CHECK_CIRCLE_FILLED'
            );
          }) ||
          r.badges?.some((b: any) => {
            const label =
              b.musicInlineBadgeRenderer?.accessibilityData?.accessibilityData?.label ||
              b.badgeRenderer?.label ||
              '';
            return /official|подтвержден|артист/i.test(label);
          }),
        );

        const artistRuns = flexCols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        const channelOrArtist = artistRuns
          .map((rn: any) => rn.text || '')
          .join(' ')
          .toLowerCase();
        const matchesArtist = Boolean(
          cleanArtist && channelOrArtist.includes(cleanArtist.toLowerCase()),
        );

        const hasOfficialKw =
          lowerTitle.includes('official') ||
          lowerTitle.includes('клип') ||
          lowerTitle.includes('music video') ||
          lowerTitle.includes('official video');

        let score = 0;
        // Prioritize official flag heavily over UGC / fan edits
        if (isOMV) score += 100;
        if (hasVerifiedBadge) score += 40;
        if (matchesArtist) score += 30;
        if (hasOfficialKw) score += 20;
        if (lowerTitle.includes('клип')) score += 10;
        if (lowerTitle.includes('video')) score += 5;

        // Boost score for closer title similarity
        const normCand = itemTitle.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
        const normTarget = cleanTitle.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
        if (normCand === normTarget) score += 25;
        else if (normCand.includes(normTarget)) score += 10;

        candidates.push({
          id: videoId,
          title: itemTitle,
          isOMV,
          hasVerifiedBadge,
          matchesArtist,
          hasOfficialKw,
          score,
        });
      };

      for (const s of sectionList) {
        if (s.musicShelfRenderer?.contents) {
          for (const item of s.musicShelfRenderer.contents) {
            inspectItem(item.musicResponsiveListItemRenderer);
          }
        }
      }

      if (candidates.length > 0) {
        // If we have definitive official videos, only select among official candidates
        const officialCandidates = candidates.filter(
          (candidate) =>
            candidate.isOMV ||
            (candidate.hasVerifiedBadge && candidate.matchesArtist) ||
            (candidate.hasOfficialKw && candidate.matchesArtist),
        );
        if (officialCandidates.length === 0) return null;
        officialCandidates.sort((a, b) => b.score - a.score);

        const topCandidate = officialCandidates[0];
        // Pre-resolve direct stream in background for performance
        this.resolveDirectVideoStream(topCandidate.id).catch(() => {});
        return topCandidate.id;
      }

      // No unrestricted search fallback: generic results often return the song's audio upload.
    } catch (e) {
      console.warn('[YouTubeMusicService] searchOfficialMusicVideo error:', e);
    }

    return null;
  }

  /**
   * Get Official YouTube Music Top Charts
   * Uses official YouTube Music Top 100 chart playlist browse endpoint
   */
  public static async getCharts(limit: number = 50): Promise<{ data: Track[]; total: number }> {
    try {
      const clientContext = this.getClientContext();
      // VLPL4fGSI1pDJn6cLcPmcc9b_l8oM0aJtsqL is official YouTube Music Top 100 Hits
      const chartJson = await this.postInnertube('/youtubei/v1/browse', {
        context: clientContext,
        browseId: 'VLPL4fGSI1pDJn6cLcPmcc9b_l8oM0aJtsqL',
      });

      const shelf =
        chartJson?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.sectionListRenderer?.contents?.[0]?.musicPlaylistShelfRenderer ||
        chartJson?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer
          ?.contents?.[0]?.musicPlaylistShelfRenderer;

      const items = shelf?.contents || [];
      const seen = new Set<string>();
      const tracks: Track[] = [];

      const nonMusicKeywords = [
        'скандал',
        'выборы',
        'дед архимед',
        'политика',
        'новости',
        'дебаты',
        'митинг',
        '10 hours',
        '10 часов',
      ];
      for (const it of items) {
        const t = parseInnerTubeShelfItem(it, seen);
        if (t) {
          const lower =
            `${t.title} ${typeof t.artist === 'object' ? t.artist.name : t.artist}`.toLowerCase();
          if (nonMusicKeywords.some((kw) => lower.includes(kw))) continue;
          tracks.push(t);
        }
        if (tracks.length >= limit) break;
      }

      if (tracks.length > 0) {
        return { data: tracks, total: tracks.length };
      }
    } catch (err) {
      console.warn(
        '[YouTubeMusicService] Failed to fetch official top charts via browse, fallback to search:',
        err,
      );
    }

    // Fallback: search for top hits
    return await this.search('Top Hits 2025 2026', limit);
  }
}
