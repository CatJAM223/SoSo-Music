# Dependency update for SoSo Music 3.3.0

The application version remains 3.3.0. Stable dependency releases were checked against npm on 2026-10-23.

## Declared versions

| Package | Before | After |
| --- | --- | --- |
| `hls.js` | `^1.7.1` | `^1.7.3` |
| `lucide-react` | `^1.16.0` | `^1.61.0` |
| `react` | `^18.3.1` | `^19.3.1` |
| `react-dom` | `^18.3.1` | `^19.3.1` |
| `sql.js` | `^1.12.0` | `^1.15.1` |
| `youtubei.js` | `18.1.0` | `18.3.0` |
| `@tailwindcss/postcss` | `new` | `^4.3.3` |
| `@types/node` | `^20.17.0` | `^24.19.2` |
| `@types/qrcode` | `^1.5.5` | `^1.5.6` |
| `@types/react` | `^18.3.12` | `^19.3.0` |
| `@types/react-dom` | `^18.3.1` | `^19.3.0` |
| `@typescript/native` | `new` | `npm:typescript@^7.0.2` |
| `@vitejs/plugin-react` | `^4.3.3` | `^6.1.2` |
| `electron` | `^44.9.0` | `^45.0.0` |
| `electron-builder` | `^25.1.8` | `^26.15.3` |
| `esbuild` | `0.21.5` | `0.28.2` |
| `postcss` | `^8.4.49` | `^8.5.31` |
| `resedit` | `^1.7.2` | `^3.1.0` |
| `tailwindcss` | `^3.4.15` | `^4.3.3` |
| `tsx` | `^4.19.2` | `^4.23.15` |
| `typescript` | `^5.6.3` | `npm:@typescript/typescript6@^6.0.2` |
| `vite` | `^5.4.11` | `^8.3.5` |
| `vite-plugin-electron` | `^0.29.0` | `^1.1.2` |
| `vite-plugin-electron-renderer` | `^0.14.6` | `^1.0.0` |

Autoprefixer was removed: Tailwind 4's PostCSS integration handles vendor prefixes. Node types stay on major 24 to match the development runtime and Electron's embedded Node.

## Migration details

- Vite configuration is an explicit ES module (`vite.config.mts`). Main/preload still emit their existing CommonJS entry names. Rolldown code-splitting groups replace the removed object form of `manualChunks`.
- Tailwind uses `@tailwindcss/postcss`, a CSS import and explicit source detection. Existing theme configuration and class-based dark mode are retained. Utility renames preserve previous small shadows, blur and radius sizes; default border color is retained.
- React refs admit `null`; `inert` is now a boolean. The queue stress fixture runs each command batch in a separate browser task, avoiding React 19's nested-update limit while retaining all 200 assertions and checking uncaught errors.
- The native TypeScript 7 checker owns `tsc`; `typescript` aliases Microsoft's TypeScript 6 compatibility API for architecture analysis and test fixtures. This follows [Microsoft's supported side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/). HLS test doubles declare their ES module shape explicitly.
- The responsiveness fixture uses the public React Profiler and counters inserted into the actual component bodies in its isolated bundle. Removed private profiling hooks are no longer used; commit and passive-effect durations are explicitly not reported.
- The Windows resource injector loads resedit 3 through its asynchronous CommonJS bridge.

## Verification

The complete check runner is `npm run test:all`; per-stage evidence is written under `scratch/check-logs`. Production bundle checks use `npm run test:production`. The packaged executable is `release/win-unpacked/SoSo Music.exe`.

The equalizer preview removes the subtitle, redundant preset/band-count status and explanatory captions requested during this update.

The preview uses an isolated local profile. Existing user application profiles and libraries are not migrated or overwritten by these checks.

## Completed checks

- Full check runner: 24 stages passed, including all 1198 Node behavior tests.
- Public React profiling: eight list-size/artwork/CPU scenarios passed.
- Actual audio graph: normalization at 3%/80%, crossfade power, buffering, mute/unmute and peak guard passed.
- Equalizer: 40 response comparisons at four sample rates, live preset retargeting, pointer/keyboard input, removed captions and reduced motion passed.
- Final production main/preload, YouTube adapter and crash/restart checks passed.
- Full Windows build succeeded on Electron 45.0.0, executable and application version 3.3.0.
- Final npm audit reported zero known vulnerabilities. Node 24 types are intentionally retained to match the runtime.
