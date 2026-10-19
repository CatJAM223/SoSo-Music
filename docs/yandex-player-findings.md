# Yandex Music: useful player findings

Research date: 2026-10-14. Desktop package inspected: 5.122.0.

This note separates observations in the supplied desktop bundle from public
engineering articles and changes independently implemented in SoSo Music.
The installer was extracted for static inspection, not executed. No original
Yandex application code or extracted assets are included in this repository.

## Implemented: prepare the songs that will actually play

The inspected player keeps a canonical entity list, playback order and current
position. Loading entities resolves positions through that order. Current and
next entities also feed transition timing. These are static code observations,
not a measurement of the running application's network behavior.

SoSo Music already had a prepared shuffle order shared by playback and the queue
drawer. Audio prefetch still selected raw array neighbors. This could prepare
an unrelated recording when shuffle was enabled, ignore a newly inserted next
song, or miss the beginning of a repeating playlist.

The independent fix uses the existing ShuffleCycle plan without consuming it:

- Prepare the first playable successor after stable playback and sufficient buffer.
- Prepare the second playable successor later, after ten seconds of playback.
- Refresh targets after queue edits, changes in playback mode or source availability.
- Skip disabled YouTube items; Wave keeps its own sequential order and never wraps.
- Suppress next-song speculation for repeat-one and sleep-at-track-end.
- Keep existing buffer protection, download concurrency, memory limits and cancellation.

Only two candidate positions are retained. Ordinary playback inspects only as many
entries as needed to find them; shuffle planning is reused between audio ticks.
No additional runtime dependency or audio decoder was introduced.

Regression coverage compares prepared targets with actual next-track commands,
including shuffle, queue insertion, wrapping, disabled sources and buffer recovery.
It also verifies that ordinary selection does not traverse a 100,000-item playlist.
Tests use controlled audio/provider fixtures; real-provider latency is not measured.

## Next candidate: coalesce bursts of skip commands

The bundle contains BurstDebounce. Isolated commands execute immediately. After
a configurable burst threshold, actual playback startup waits for the final
selection. Queue navigation still advances on every command. The player invokes
this path behind an isSkipDebounceEnabled setting for some manual navigation.
Presence of this path does not establish which deployments enable it.

SoSo already rejects stale replies and cancels local resolution deadlines, but
its platform resolver interface does not pass the renderer AbortSignal through
to the provider. A burst policy could avoid some intermediate provider requests.
This remains a candidate, not an enabled change: thresholds should be validated
against keyboard navigation and pause/new-selection races first.

## Next candidate: separate URL preparation from bulk audio caching

The bundle exposes separate preparation states for source URLs and source bytes.
That distinction is useful for signed, short-lived URLs and sources that cannot
be cached as complete audio files. SoSo already has URL caches and bounded audio
caching, so the useful follow-up is measuring actual cache reuse and wasted
preparations before expanding either cache.

## Electron wrapper findings and SoSo-specific optimization

The inspected desktop entry creates a BrowserWindow with ordinary isolated,
sandboxed web preferences. It does not explicitly disable background throttling
or append global Chromium command-line switches in that entry. Window lifecycle
events track hide/minimize/focus, and an application suspension blocker follows
playback state. Static inspection cannot establish the application's total RAM
usage or rule out additional runtime policies elsewhere.

The useful lesson is to give resources a specific owner and lifecycle. This
also follows the [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance)
on allocating work only when needed. The following implementation addresses a
SoSo-specific issue; it is not a claim about Yandex having the same widget.

SoSo's desktop widget previously entered mountPlayer before DesktopApp selected
the widget view. Consequently its renderer imported the main application and
mounted AudioProvider, playback/session logic and recommendation initialization.
It now has its own lazy route. The widget retains ThemeProvider for its saved
appearance, but the main player, audio/HLS engine and recommendation WASM are
outside its startup graph.

An Electron regression opens the real renderer entry three times with a minimal
widget bridge. It checks all remote controls, incoming paused/liked state and
saved accent. Requested JavaScript is mapped to bundler input modules: zero main
player modules and zero external requests are permitted. The current esbuild
fixture loads 353,365 bytes of JavaScript; this is neither the production Vite
bundle size nor a measurement of total Chromium RAM.

A separate production check loads the actual Vite output. Its five requested
JavaScript files total 271,663 bytes, and all widget controls/appearance checks
pass. The previous packaged 3.1.0 widget startup dependency graph required
1,194,662 bytes across six JavaScript files. The new graph matches the measured
requests: 77.3% fewer JavaScript bytes at widget startup. The before figure is
computed from the previous package's imports; it is not a historical network
trace. These figures do not measure total RAM or startup latency.

Progress correction previously ran every five seconds while playing, including
when no widget was open. A visibility subscription now starts that interval only
for an open, playing widget and releases it on close/pause/unmount. Discrete track
metadata still reaches the main process and overlay. Initial state responses
cannot override newer open/close events, and late replies after unmount are inert.

The existing background playback flags were not changed: the inspected Yandex
preferences alone do not prove that removing them is safe for SoSo's YouTube
transport, crossfades or recovery timers.

## Further verified candidates

The desktop entry's background jobs check whether the window is hidden before
requesting track-availability or repository-metadata refreshes. They also compare
stored update timestamps against refresh intervals. Focus/activation can trigger
application-data refresh after sufficient time away. The inspected condition is
isWindowHidden; it must not be generalized to every minimized or occluded state.

The same entry includes a small useCachedValue wrapper around persisted values.
For SoSo the relevant independent opportunity is the library-taste service:
with auto-analysis enabled, its 30-second check can read and summarize unchanged
saved tracks and genre tags again. Report polling and Wave enrichment also request
those data. SoSo now caches one library-derived snapshot keyed by database identity
and an in-memory mutation generation. Genre summaries and completed automatic
checks reuse that snapshot. Save paths advance the generation synchronously;
likes, dislikes, playlist/import changes and tag writes therefore invalidate
cached data without waiting for a TTL. The invalidation is conservative: unrelated
database saves can also rebuild the snapshot.

A local in-memory SQLite probe with 2,000 fully analyzed saved tracks ran three
consecutive libraryChanged checks without modifying the library. It observed
24 prepare/exec calls, 185 ms total on this machine and zero provider calls.
This was a single diagnostic sample, not a production benchmark. After implementing
the cache, a 2,000-track regression warmed one snapshot and performed 100 repeated
report/automatic-check/Wave-enrichment rounds with zero SQLite calls and zero
provider requests. This diagnostic run took 1.51 ms; the timing is machine-dependent
and includes assertions. It must not be extrapolated to total application speed.

Progress, running state and lookup failures remain live fields. Returned genre
summaries are copied so callers cannot mutate the cached result. Manual analysis
still checks tag age, cancelled records stay paused, and new additions are detected.
The store keeps one snapshot; derived summaries and completed-check markers use
weak references. Replacing/disconnecting the database and failed save callbacks
also discard cached data. Callers without mutation tracking retain live reads.

The previously noted burst-skip policy remains another concrete candidate. Its
value is avoiding intermediate provider requests while preserving every queue
navigation command, rather than merely discarding late results afterward.

## Public sources and limits

- [Yandex Infrastructure: short video feed optimization](https://habr.com/ru/companies/yandex/articles/1027160/)
  describes playback priority over speculative loads, bounded preparation and
  buffer adaptation. The article concerns video feeds; its numeric tuning and
  reported gains must not be presented as results for this audio player.
- [Yandex Music: discovery mode](https://habr.com/ru/companies/yandex/articles/845680/)
  explains context-dependent recommendation objectives. SoSo's recent Wave changes
  apply this general idea through separate mode sessions and feedback handling;
  they do not reproduce Yandex's trained ranking model.

No production recommendation weights, usable catalog identity mapping or complete
server-side recommender were recovered from this desktop package.
