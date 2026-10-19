import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const scratch = path.join(root, 'scratch');
fs.mkdirSync(scratch, { recursive: true });
const directory = fs.mkdtempSync(path.join(scratch, 'desktop-bootstrap-'));
const production = process.argv.includes('--production');
const crashes = process.argv.includes('--crashes');
const mainEntry = production ? 'main.js' : 'main.cjs';
const mutation = process.env.SOSO_DESKTOP_PROBE_MUTATION || '';
if (production && mutation) throw Error('Mutations apply only to isolated source builds');
if (!['', 'media-wiring', 'sync-wiring', 'wallpaper-src', 'csp-remote'].includes(mutation))
  throw Error('Unknown desktop probe mutation');
let mutations = 0;
const mutationsPlugin = {
  name: 'isolated-desktop-mutations',
  setup(builder) {
    builder.onLoad({ filter: /(?:main[/\\]index\.ts|WallpaperBackground\.tsx)$/ }, (args) => {
      let contents = fs.readFileSync(args.path, 'utf8');
      let from, to;
      if (mutation === 'media-wiring' && args.path.endsWith('index.ts')) {
        from =
          "protocol.handle('media', createMediaHandler(mediaFileAccess, process.env.VITE_DEV_SERVER_URL));";
        to = "protocol.handle('media', async () => new Response(null, {status:404}));";
      } else if (mutation === 'sync-wiring' && args.path.endsWith('index.ts')) {
        from = "'sync:start': () => lanSyncServer.start(),";
        to = "'sync:start': () => ({active:false,addresses:[]}),";
      } else if (mutation === 'wallpaper-src' && args.path.includes('shared')) {
        from = '          src={src}\n          autoPlay';
        to = '          src={undefined}\n          autoPlay';
      }
      if (!from) return;
      if (contents.split(from).length !== 2)
        throw Error('Desktop mutation must match exactly once');
      contents = contents.replace(from, to);
      mutations++;
      return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' };
    });
  },
};
try {
  if (production) {
    const distribution = path.join(root, 'dist-electron');
    if (!fs.existsSync(path.join(distribution, 'main.js')))
      throw Error('Build the application before production checks');
    fs.cpSync(distribution, path.join(directory, 'dist-electron'), { recursive: true });
  } else {
    await build({
      entryPoints: [path.join(root, 'src/desktop/main/index.ts')],
      outfile: path.join(directory, 'dist-electron/main.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['sql.js', 'youtubei.js'],
      plugins: [
        mutationsPlugin,
        {
          name: 'isolate-operating-system-effects',
          setup(builder) {
            builder.onResolve({ filter: /^electron$/ }, () => ({
              path: 'electron',
              namespace: 'probe',
            }));
            builder.onLoad({ filter: /.*/, namespace: 'probe' }, () => ({
              contents: 'module.exports = globalThis.__desktopProbeElectron;',
              loader: 'js',
            }));
          },
        },
      ],
    });
    await build({
      entryPoints: [path.join(root, 'src/desktop/preload/index.ts')],
      outfile: path.join(directory, 'dist-electron/preload.js'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
    });
  }
  await build({
    entryPoints: [path.join(root, 'scripts/testing/desktopBootstrapFixture.tsx')],
    outfile: path.join(directory, 'dist/fixture.js'),
    bundle: true,
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [mutationsPlugin],
  });

  let html = fs.readFileSync(
    path.join(root, production ? 'dist/index.html' : 'index.html'),
    'utf8',
  );
  if (mutation === 'csp-remote') {
    const before = "script-src 'self' 'wasm-unsafe-eval';";
    if (html.split(before).length !== 2) throw Error('CSP mutation anchor changed');
    html = html.replace(before, "script-src 'self' 'wasm-unsafe-eval' https:;");
    mutations++;
  }
  if (mutation && mutations !== 1) throw Error('Desktop mutation was not applied exactly once');
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
  if (!csp) throw Error('Missing application CSP');
  fs.writeFileSync(
    path.join(directory, 'dist/index.html'),
    '<!doctype html><meta http-equiv="Content-Security-Policy" content="' +
      csp +
      '"><div id="root"></div><script src="fixture.js"></script>',
  );
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.VITE_DEV_SERVER_URL;
  const phases = crashes
    ? ['initial', 'renderer-crash', 'main-crash', 'after-crash']
    : ['initial', 'restart'];
  for (const phase of phases) {
    const logPath = path.join(directory, phase + '.log');
    const result = spawnSync(
      require('electron'),
      [
        path.join(root, 'scripts/testing/desktopBootstrapProbe.cjs'),
        directory,
        root,
        phase,
        mainEntry,
      ],
      {
        cwd: root,
        env: environment,
        windowsHide: true,
        timeout: 40000,
        encoding: 'utf8',
      },
    );
    fs.writeFileSync(logPath, (result.stdout || '') + (result.stderr || ''));
    const sessionFile = path.join(directory, 'profile/logs/runtime-session.json');
    if (
      phase === 'main-crash' &&
      !result.error &&
      result.status !== 0 &&
      (result.signal || (result.status !== null && result.status >>> 0 > 128)) &&
      result.stdout?.includes('EXPECTED_MAIN_CRASH')
    ) {
      if (JSON.parse(fs.readFileSync(sessionFile, 'utf8')).cleanExit !== false)
        throw Error('Native main crash was incorrectly recorded as a clean quit');
      console.log('NATIVE_MAIN_CRASH_OK ' + JSON.stringify({ exitCode: result.status }));
      continue;
    }
    if (result.error || result.status !== 0) {
      fs.copyFileSync(logPath, path.join(scratch, 'desktop-bootstrap-failure.log'));
      throw Error(
        'Desktop bootstrap ' +
          phase +
          ' failed: ' +
          (result.error?.message || result.status) +
          '\n' +
          fs.readFileSync(logPath, 'utf8'),
      );
    }
    const summary = result.stdout
      .split('\n')
      .find((line) => line.startsWith('DESKTOP_BOOTSTRAP_OK'));
    if (!summary) throw Error('Desktop probe exited without completing its assertions');
    if (JSON.parse(fs.readFileSync(sessionFile, 'utf8')).cleanExit !== true)
      throw Error('Normal quit must mark the session clean');
    if (phase === 'after-crash') {
      if (
        !((result.stdout || '') + (result.stderr || '')).includes(
          'Previous session ended without a normal quit',
        )
      )
        throw Error('Native crash was not detected after restart');
      const dumps = fs
        .readdirSync(path.join(directory, 'profile/Crashpad'), { recursive: true })
        .filter((file) => file.endsWith('.dmp'));
      if (dumps.length < 2) throw Error('Expected local dumps for real renderer and main crashes');
      console.log('LOCAL_CRASH_DUMPS_OK ' + dumps.length);
    }
    console.log(summary);
  }
} finally {
  if (
    path.dirname(directory) !== scratch ||
    !path.basename(directory).startsWith('desktop-bootstrap-')
  )
    throw Error('Unexpected desktop probe directory');
  fs.rmSync(directory, { recursive: true, force: true });
}
