import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = path.join(root, 'scratch');
fs.mkdirSync(scratch, { recursive: true });
const output = fs.mkdtempSync(path.join(scratch, 'player-state-browser-'));
const require = createRequire(import.meta.url);
try {
  await build({
    stdin: {
      contents: fs.readFileSync(path.join(root, 'scripts/testing/playerStateFixture.tsx'), 'utf8'),
      resolveDir: root,
      loader: 'tsx',
    },
    bundle: true,
    platform: 'browser',
    jsx: 'automatic',
    outfile: path.join(output, 'fixture.js'),
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'fixture-transport',
        setup(builder) {
          builder.onResolve({ filter: /bridge\/platformBridge$/ }, () => ({
            path: 'bridge',
            namespace: 'fixture',
          }));
          builder.onResolve({ filter: /context\/AudioContext$/ }, () => ({
            path: 'audio',
            namespace: 'fixture',
          }));
          builder.onResolve({ filter: /services\/offlineCacheService$/ }, () => ({
            path: 'offline',
            namespace: 'fixture',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents:
              args.path === 'audio'
                ? 'window.mockAudio={likedTrackIds:new Set(),savedAlbumIds:new Set(),followedArtistIds:new Set(),cachedTrackIds:new Set(),playTrack(){}};export const useAudio=()=>window.mockAudio;export const useAudioState=()=>window.mockAudio;export const useAudioControls=()=>window.mockAudio;'
                : args.path === 'bridge'
                  ? 'export const platformBridge={getLikedTrackIds:async()=>[],getDislikedTrackIds:async()=>[],getSavedAlbums:async()=>[],getFollowedArtists:async()=>[],getLikedTracks:async()=>[],getPlaylists:async()=>[],getListeningHistory:()=>window.historyRead?window.historyRead():Promise.resolve([]),clearListeningHistory:async()=>true};'
                  : 'export const offlineCacheService={getAllCachedTracks:async()=>{window.offlineReads++;return[];}};export const subscribeOfflineCacheChanges=fn=>{window.offlineListeners.add(fn);return()=>window.offlineListeners.delete(fn);};',
            loader: 'js',
          }));
        },
      },
    ],
  });
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="fixture.js"></script>',
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(
    require('electron'),
    [path.join(root, 'scripts/testing/playerStateProbe.cjs'), output],
    { cwd: root, env, windowsHide: true, stdio: 'inherit', timeout: 30000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Native player state check failed: ' + result.status);
} finally {
  if (
    path.dirname(output) !== scratch ||
    !path.basename(output).startsWith('player-state-browser-')
  )
    throw Error('Unexpected fixture directory');
  fs.rmSync(output, { recursive: true, force: true });
}
