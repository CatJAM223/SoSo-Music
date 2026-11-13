# Changelog

### [4.1.1] — 2026-11-13

#### Playback and recommendations

- Prepare the next queued track in a separate audio element and transfer its ready buffer at playback transitions, including HLS where supported.
- Add bounded retries, cancellation and startup recovery for prepared audio; keep crossfade volume transitions smooth.
- Restore the buffered-range indicator when a prepared track becomes active. Discard failed or obsolete prepared media and ignore stale HLS errors after switching sources.
- Let Wave discovery favor styles confirmed by multiple successful listens in the current session, with the affinity calculation in the Rust compute core.

### [4.1.0] — 2026-11-13

#### Playback and account reliability

- Smooth the first milliseconds of YouTube Music playback to suppress startup transients without skipping the track opening.
- Keep YouTube account prompts scoped to account-dependent actions, preserve explicit opt-out choices and recover safely when imported cookies change.
- Improve stream startup recovery, offline audio handling, playback session ownership and listening-room reliability.
- Harden media URL and file access checks, playback lifecycle cleanup, lyrics identity handling and background synchronization.

### [4.0.2] — 2026-11-05

- Try the same signed-in recording's watch response when the player API provides SABR-only or otherwise unsupported formats, without clearing login cookies.
- Preserve the original format error if the alternate watch route is unavailable.
- Add global shortcut registration, activation and renderer receipt diagnostics to distinguish OS/game input handling from background command delivery. Fullscreen Frostpunk input interception remains under investigation.

### [4.0.1] — 2026-11-05

#### Playback stability and offline downloads

- Fall back from failed HLS manifests and broken renditions to other supported streams of the same recording.
- Share a bounded startup deadline across URL resolution and automatic retries; reset it when playback starts.
- Reject partial, truncated and error-document responses before caching audio. Preserve prefetch cache behavior and bound concurrent transfers.
- Cancel offline operations through URL resolution, transfer and fallback when their track is removed or the cache is cleared.
- Fix Electron manual-redirect downloads without a document origin.
- Save progressive offline audio directly to private files with atomic completion, cancellation cleanup and local range playback. Keep existing IndexedDB downloads readable; HLS continues to use bounded segment assembly.

### [4.0.0] — 2026-11-01

#### Listen together

- Add internet listening rooms with native Rust networking, invitation copying, a shared queue and up to eight participants. Anyone in the room can add songs; the host controls playback through the main player.
- Start the first song automatically when the room queue is empty. Prepare audio on connected players before releasing the shared clock so songs start near 0:00 instead of skipping their opening seconds.
- Add cancellable connection setup, bounded retries, transport keepalive and diagnostic reasons. Pause playback when shared timing becomes stale; allow temporary transport recovery without immediately destroying the room.
- Replace the large invitation panel with a circular copy button beside the exit button. Move Add tracks into the current-track card and remove duplicate room playback controls.
- Highlight songs already present in the shared queue in search and My Music, prevent accidental repeated additions, remove orange plus buttons and enlarge participant text. Keep queue highlighting free of redundant status badges.

#### My Wave and daily recommendations

- Move daily selection, recommendation duration decisions, history ageing and additional matching decisions into required Rust compute. Wave accepts songs up to ten minutes and filters duplicate recordings across provider uploads.
- Share bounded taste snapshots between candidate generation and renderer sorting. Count unique songs when refilling, retain alternate uploads, look deeper into catalogs and limit all producer requests through one cancellable scheduler.
- Preserve verified recording identities through background worker sorting, taste seeds and learning. Separate briefly auditioned songs from substantial listening and avoid treating errors or interruptions as negative taste evidence.
- Recognize new songs by familiar artists separately from unfamiliar performers when adjusting exploration. Keep mode-specific session feedback and constrain repeated early-skip refreshes.
- Preserve track-specific musical evidence when artist tags are used as fallback. Scale musical-transition penalties by the strength of mood evidence; ignore navigation before half a second when deciding to refresh discovery.
- Bound optional tag enrichment with one batch deadline, expire YouTube search results and record only songs retained by final queue sorting. Include final offered positions and a new ranker cohort in local quality reports.
- Keep daily picks diverse, respect disliked recording families, retain valid same-day picks, retry partial results and partition selection by the chosen music source.

#### Playback and music catalogs

- Recover short or incomplete YouTube MP4 responses before playback; reject files without usable media data and try a supported alternate route for the same recording.
- Improve cancellation, stalled-start recovery, HLS preparation and preservation of queue/position during provider errors. Keep offline playback independent of delayed artwork.
- Add Rust search ranking and improve album edition matching, artist normalization and recording identity handling.

#### Interface and background activity

- Drive the playback timeline from the real media clock, with pointer/keyboard seeking, preview feedback and no invented movement while audio is stalled.
- Add responsive transport controls, animated navigation selection, queue transitions and restrained track/artwork entry effects with reduced-motion support.
- Sleep decorative effects when the player loses focus, is minimized or is hidden in the tray. Release wallpaper video, suspend background drawing and cursor glow, then restore decoration and catch the timeline up to actual audio time on return. Music keeps playing.

#### Security and release packaging

- Default IPC handlers to the main frame of the main window, restrict auxiliary-window permissions and expose only the widget methods it needs.
- Count legacy Wave requests without cancellation IDs, cancel them when their sender closes, validate input before expensive processing and reuse one taste-policy snapshot per request.
- Validate widget commands and keep room artwork restricted to supported media hosts.
- Publish Windows x64 portable ZIP and 7z archives with the application directly at the archive root and SHA-256 checksums. Preserve the full application resources beside the executable.

#### Additional engine and maintenance changes

- Extract playback ownership into a standalone engine with explicit phases and a React subscription adapter; retain cancellation, bounded recovery and crossfade behavior.
- Add recording/provider/source/queue domain identities and durable verified source aliases, preserving likes, legacy libraries and backups. Use canonical IDs to suppress Wave repeats across provider uploads.
- Add local Wave recommendation attribution and outcome reports. Move imported/canonical recording decisions and listening feedback to Rust ABI 6, removing their former TypeScript rule bodies.
- Remove redundant downloaded-track and recent-history captions from My Music.

- Remove three disconnected modules and unused service, parser, queue and theme helpers. Retarget catalog deduplication, SoundCloud policy, prefetch and crossfade tests to active production paths; retain diagnostic hooks and Rust utility entry points.

- Bound progressive playback startup and offline-cache reads; preserve the selected recording and position after exhausted network retries. Rearm stalled-stream recovery after brief progress and release watchdogs on pause and teardown.
- Add retryable, localized startup recovery with a 15-second deadline; allow required Rust initialization to retry after failure without clearing user data.
- Record structured startup outcomes, cancellations, buffering and source recovery. Include committed library/playlist preparation in startup timing and add a local aggregate report without track titles or stream URLs.
- Batch directed song comparisons in Rust ABI 5 to reduce repeated packet encoding and WASM calls during catalog deduplication. Preserve matching order, conditional acceptance, dense batching and existing recording rules.

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
