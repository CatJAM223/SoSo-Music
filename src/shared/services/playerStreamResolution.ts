import type { StreamResolveOptions, Track } from '../types/index.ts';
import { withStreamResolveDeadline } from '../utils/streamResolveDeadline.ts';

const STREAM_RESOLUTION_TIMEOUT_MS = 30000;
type ResolveStream = (track: Track, options: StreamResolveOptions) => Promise<string>;

export function resolvePlayerStream(
  track: Track,
  options: StreamResolveOptions,
  signal: AbortSignal,
  resolve: ResolveStream,
): Promise<string> {
  const artist =
    typeof track.artist === 'object' && track.artist
      ? track.artist
      : { name: String(track.artist || '') };
  let finished = false;
  const lookup = async () => {
    signal.throwIfAborted();
    const item = { ...track, artist };
    const url = await resolve(item, options);
    if (finished) return '';
    signal.throwIfAborted();
    // An empty cached/provider answer gets one fresh lookup before abandoning the recording.
    // Access errors and temporary failures still use their existing, separate recovery budgets.
    if (url || options.forceRefresh) return url;
    return resolve(item, { ...options, forceRefresh: true });
  };
  return withStreamResolveDeadline(lookup(), STREAM_RESOLUTION_TIMEOUT_MS, signal).finally(() => {
    finished = true;
  });
}

interface RecoveryRequest {
  track: Track;
  options: StreamResolveOptions;
  signal: AbortSignal;
  allowPreview: boolean;
}
interface RecoveryActions {
  resolve: ResolveStream;
  isCurrent: () => boolean;
  isPlayable: (url: string, track: Track) => boolean;
  resolved: () => void;
  load: (url: string) => void;
  preview: (url: string) => void;
  unavailable: () => void;
  failed: (error: unknown) => void;
}

/** Only the request that still owns playback may install a replacement source. */
export async function recoverPlayerStream(
  request: RecoveryRequest,
  actions: RecoveryActions,
): Promise<void> {
  try {
    const url = await resolvePlayerStream(
      request.track,
      request.options,
      request.signal,
      actions.resolve,
    );
    if (!actions.isCurrent()) return;
    actions.resolved();
    if (actions.isPlayable(url, request.track)) actions.load(url);
    else if (request.allowPreview && actions.isPlayable(request.track.preview, request.track))
      actions.preview(request.track.preview);
    else actions.unavailable();
  } catch (error) {
    if (actions.isCurrent()) actions.failed(error);
  }
}
