import { Innertube, Platform, Log, Player, YT } from 'youtubei.js';

/** Static library references inside a lazy adapter survive production tree shaking. */
export function createYouTubeAccountClient(
  options: Parameters<typeof Innertube.create>[0],
  evaluate: (code: string) => Promise<Record<string, unknown>>,
): Promise<Innertube> {
  Log.setLevel(Log.Level.NONE);
  Platform.shim.eval = (data) => evaluate(data.output);
  return Innertube.create(options);
}
export function createYouTubeAccountPlayer(...args: Parameters<typeof Player.create>) {
  return Player.create(...args);
}
export function parseYouTubeAccountWatchInfo(response: any, actions: Innertube['actions']) {
  return new YT.VideoInfo([{ data: response, success: true, status_code: 200 }], actions, '');
}
