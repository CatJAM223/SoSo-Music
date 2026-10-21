# Changelog

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
