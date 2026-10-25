# Changelog

### [3.3.4]

- Move offline MPEG-TS/PES audio extraction and playlist-import scoring/ranking to required Rust ABI 4. Select audio through PAT/PMT, retain segment boundaries, validate transport integrity and remove the old production TypeScript algorithms.
- Replace approximate loudness polling with continuous mono/stereo BS.1770 K-weighting, gated LUFS and 4x true-peak analysis in a Rust AudioWorklet; preserve fixed playback gain, crossfades, pause/seek behavior and provider metadata priority.
- Keep Wave taste scoring, history/exposure filtering, version choice, matching and ordering in Rust, with managed renderer Workers and no production JavaScript scorer fallback.
- Fix startup loading coverage and preserve its animation until the lazy player commits; fade into the ready interface and release the loading screen on errors.

- Add a persistent chart-region selector with Worldwide and 19 supported countries; load official weekly song rankings and batch metadata for exact chart recordings, validating region and preserving provider positions.
- Remove chart/genre heading captions and the genre heading icon; restore a visible hover surface on the highlighted karaoke/chords control.

- Keep the charts section exclusively on official YouTube Music song rankings; remove SoundCloud chart routing, source controls and mixed-chart state. Preserve original chart positions.
- Use verified SoundCloud genre playlists only for genre browsing, with recording hydration and strict per-track classification.

- Read the official global YouTube Music song chart with current catalog layouts; remove generic Top Hits search substitutions and show retry controls on failure.
- Share song-duration, mix/tempo-edit and recording-family deduplication across charts and genres; require explicit matching SoundCloud genre tags and use YouTube Songs-only discovery with credited artist matching.
- Load genre selections per source with separate expiring caches, stale-request protection and a refresh action.

- Recover unavailable YouTube uploads using an available recording with matching title, artist and duration; preserve saved track IDs and the selected service.
- Follow artist release, video and album continuations; remove the ten-release catalog cap, filter unrelated search results and clear stale artist data on navigation.
- Group releases and assign SoundCloud album membership by recording/release IDs to avoid mixing same-title songs and albums.

- Update Electron to 45, React to 19, Vite to 8, Tailwind CSS to 4, electron-builder to 26 and the native TypeScript checker to 7; refresh playback, database, icon and build dependencies.
- Migrate Tailwind utilities, PostCSS, React refs/inert attributes and Rolldown chunk configuration; retain the supported TypeScript 6 compiler API for code-analysis tools.

- Apply recording normalization in the shared audio graph so quiet recordings receive their full correction at high slider levels; preserve crossfade envelopes, guard boosted peaks and let the capture stream settle before analysis.
- Verify normalization with real decoded audio at 3% and 80% volume, equalizer independence, buffering, mute/unmute and crossfade completion.

- Add a 10-band equalizer to Settings → Playback with an interactive frequency-response graph, precise gain input and seven built-in presets: Default, Headphones, Speakers, Bass boost, Vocals, Rock and Soft sound.
- Morph the curve and control points smoothly between presets, following live audio filter values; rapid selection continues from the current curve and respects reduced motion.
- Preserve equalizer settings across restarts, apply them to playback and snippets, smooth filter changes and reserve headroom for overlapping boosts.
- Verify the frequency response against native Web Audio at four sample rates and cover live audio, preset transitions, keyboard/pointer controls and snippet lifecycle.

### [3.2.3]

- Isolate overlay storage from playback checkpoints to prevent memory accumulation during long listening sessions. Preserve language changes, positioning and authorized local artwork through IPC and the isolated media handler.
- Use a compact overlay window, release its renderer while hidden, load smaller track thumbnails and reduce the temporary audio cache limit to 16 MiB.
- Improve SoundCloud delivery-domain support, artist catalog pagination, album matching and propagation of network errors.
- Cancel superseded provider searches and show partial results with retry controls when a provider fails.
- Simplify My Music and playlist headers, show subtle sidebar track counts and align total duration above the duration column.
- Identify window roles and private process memory in runtime diagnostics; expand native Electron, playback and regression checks.
- Publish portable Windows x64 builds in both ZIP and 7z formats with SHA-256 checksums.

### [3.2.0]

- Preserve in-flight prefetch for the selected track instead of cancelling and resolving it again; pause, switching and shutdown still cancel stale work.
- Start RAM-cached audio before IndexedDB lookup and play offline audio without waiting for artwork. Apply late artwork only to its owning playback request.
- Verify startup regressions through the actual player/cache/shared-resolver chain and isolated mutation checks.

### [3.1.5]

- Save local native crash dumps, main/child-process errors, session exit status and bounded memory diagnostics. Recover the main renderer with a retry budget; verify real renderer and main-process crashes in an isolated profile.

- Run the full Electron/UI suite and integration sensitivity checks in CI and before releases. Verify real main/preload wiring, wallpaper decoding/seek/restart, foreign-window rejection and browser CSP enforcement; check the production YouTube adapter after building. Replace inline boot JavaScript with local assets and hash the development React Refresh preamble.

- Restrict local wallpapers to picker-approved file capabilities, upgrade Electron to 44.9.0, and cancel concurrent LAN starts safely. Reselect an existing wallpaper once after upgrading.

- Restore overlays from actual native visibility without moving them to the cursor display; recreate a failed renderer on the next toggle. Use a full-window update backdrop with a smaller announcement card.
- Refresh SoundCloud snippet links before playback and recover once through another rendition; closing or pausing prevents stale preview callbacks from restarting audio. Remove library item counters from My Music tabs.
- Bound silent HLS startup to 8 seconds, try another SoundCloud rendition on recovery and keep HLS MediaSources separate from cached audio files. Preserve the queue on repeated transport timeouts and support the soundcloud.cloud delivery domain.
- Recover removed saved SoundCloud recordings through bounded matching in the same service, preserving library IDs.
- Preserve the signed-in YouTube watch parser in production builds, retry internal client bootstrap once and distinguish preparation errors from network failures.

- Daily recommendations remember artist rejection from two distinct disliked songs, reduce priority after one, and refresh cached picks when dislikes change.
- Bounded stream retries with Retry-After and cancellable shared stream requests.
- Paged library search, virtual card grids and complete playback queues.
- Reversible track and playlist exclusions from the taste profile, independent of dislikes.
- Stable identities for repeated queue entries and bounded recovery from stalled playback.

### [3.1.0]

- Preserve disabled overlay settings when other preferences are damaged; cancel delayed shortcut recording on blur; allow Esc to leave position editing after a failed save; recover artwork through bounded fallback URLs.
- Support single-key and two-key shortcuts, an overlay on/off choice in integrations and onboarding, and fewer background overlay updates.
- Global configurable shortcuts for playback and a transparent, click-through track overlay with a separate position editor and compact keycap settings.
- Background GitHub release checks with a minimal update announcement that preserves playback.
- Language selection moved to Appearance.
- My Wave spaces liked recordings between other available songs, including across batch boundaries.
- Queue fits below the title bar, keeps the current track visible, and offers clearer rows and compact track actions.

### [3.0.5]

- English and Russian interface with a persistent RU/EN switch in Settings.
- Optional Last.fm API key stored locally, with setup links in Settings and the introductory tour.
- Bilingual project documentation and a refreshed introductory tour.
- Consistent My Wave button and queue: feedback and background refill preserve the announced next track.
- Clearer queue display without redundant repeat labels.
- More distinct wave modes, less repeated exposure and a Last.fm library genre profile.
- Bounded stream recovery, clearer playback logs and less background work.

Earlier notes are preserved in the [Russian development history](docs/changelog-archive.ru.md). These notes describe local source changes; see [GitHub Releases](https://github.com/CatJAM223/SoSo-Music/releases) for published packages.
