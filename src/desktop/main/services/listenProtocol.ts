import type { App } from 'electron';
import {
  SOSO_LISTEN_SCHEME,
  getSoSoListenTrackFromArgs,
  parseSoSoListenTrack,
} from '../../../shared/utils/localListenLink.ts';
import type { Track } from '../../../shared/types/index.ts';

/** Attach synchronously so launch URLs arriving before app.ready are retained by the receiver. */
export function configureListenProtocol(
  app: Pick<App, 'on' | 'isPackaged' | 'setAsDefaultProtocolClient'>,
  onListen: (track: Track) => void,
  argv: readonly string[] = process.argv,
): boolean {
  // Dev Electron must not replace the user's association with the packaged player.
  const registered = app.isPackaged && app.setAsDefaultProtocolClient(SOSO_LISTEN_SCHEME);
  if (app.isPackaged && !registered) {
    console.warn('[Listen] Unable to register sosomusic links');
  }
  app.on('open-url', (event, url) => {
    const track = parseSoSoListenTrack(url);
    if (!track) return;
    event.preventDefault();
    onListen(track);
  });
  app.on('second-instance', (_event, args) => {
    const track = getSoSoListenTrackFromArgs(args);
    if (track) onListen(track);
  });
  const initial = getSoSoListenTrackFromArgs(argv);
  if (initial) onListen(initial);
  return registered;
}
