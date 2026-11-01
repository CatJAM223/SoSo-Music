# Playback engine, recording identity and measured Wave quality

Changes made on 2026-10-27 for priorities 1–3.

## Playback ownership

The complete playback runtime moved from the React hook into src/shared/services/playbackEngine.ts. There is no second playback implementation. The hook now constructs the owner, updates its dependencies, subscribes with useSyncExternalStore, and mounts/disposes it.

The engine owns media subscriptions, startup and progress watchdogs, cancellation, source renewal, crossfade ownership, listening sessions and cleanup. It publishes stable immutable snapshots and explicit phases: idle, preparing, playing, paused, buffering, recovering, waiting-network, ended and failed. Phase is available through the audio state context. Existing refs/control contracts remain compatibility adapters for snippets, queue and library orchestration.

The standalone VM fixture now exercises the production engine without simulating React hooks. Tests cover rapid selection, stale responses, queue exhaustion/edits, native and HLS recovery, offline behavior, disposal/remount and observable phase changes. Real React/Electron fixtures remain separate integration checks.

## Domain identity and compatibility

musicDomain.ts separates Recording, ProviderTrackRef, PlayableSource and QueueEntry. Provider IDs remain the cache/transport keys; a queue ID denotes one occurrence. Temporary stream URLs do not enter persisted recording identity. Engine accessors expose the current domain recording and ephemeral playable source.

Unmatched recordings get stable provider-qualified IDs, not title hashes. SQLite schema 3 adds recordings and provider_tracks without rewriting or deleting existing library, history or playlist rows. Only an actually resolved replacement can establish a durable alias. Rust requires matching complete normalized title/version, matching artist credit and known durations within two seconds; live/remix/acoustic/remaster text is retained. This is conservative metadata verification, not an acoustic fingerprint.

The broader imported-track recovery rule remains available through the same Rust module; a playable replacement with a larger duration discrepancy does not automatically merge permanent identities.

Verified aliases participate in search/Wave responses, library/playlist/history reads, likes, JSON backup/restore and the saved listening context. The renderer refreshes membership after a newly linked source. Old backups/sessions without identity metadata remain valid. Canonical IDs survive session restore; signed stream URLs do not.

The Rust queue ranker uses canonical IDs in recent-history exclusion, candidate deduplication, exposure and like matching. A deterministic fixture compares the same production ranker with and without canonical metadata; see benchmarks/wave-identity-2026-10-27.json. This establishes repeat suppression for verified aliases with changed metadata, not improved subjective recommendation quality.

## Wave measurement

Every newly admitted Wave proposal has a recommendation ID, rank, mood, familiarity and rust-sequence-v1 ranker version. Offered, selected, actual-start, terminal-outcome and like events use [Wave:Quality] in the existing local playback log. No song titles, artist names, signed addresses, audio or account data are needed in these structured events.

A playback episode owns its attribution across pause, buffering and source retries. Repeated playing/finish notifications do not count twice. Actual played media seconds feed outcomes; seeking does not pretend a track was heard. Errors, interruptions, incomplete episodes and selections that never started remain separate from the listening preference denominator.

Run:

~~~sh
npm run report:wave -- path/to/playback.log path/to/playback.old.log
npm run eval:wave-identity
~~~

The report groups outcomes by ranker and mood, deduplicates rotated/repeated event input, and reports offers, repeated recording offers, starts, unfamiliar starts, early skips, listened completions, likes, errors, interruptions and incomplete episodes. Completion means at least 80% measured listening, consistent with the existing feedback contract. Duplicate offers describe the supplied log range; they do not imply that every later repeat is a ranking bug.

The scoring rule and imported/canonical recording decisions now have one production Rust implementation (ABI 6). TypeScript prepares metadata, packets and reports; the former TypeScript decision/scoring bodies were removed. No JavaScript algorithm fallback was introduced. This does not establish a speedup for individual scalar WASM calls.

Actual skip/like/completion rates need listening data collected after this change. No weight tuning or subjective A/B win is claimed from synthetic fixtures.

## Interface cleanup

Removed the redundant downloaded-track and recent-history captions in My Music. Clear-history remains available and right aligned.

## Validation

- Renderer/main/preload build passed.
- All 26 groups in npm run test:all passed, including 1,253 Node tests, React state, native crash recovery, UI/resource lifecycle and sensitivity checks.
- After Rust formatting, the final ABI 6 artifact passed npm run test:rust (10 native-adapter tests plus Chromium/Worker validation) and npm run test:production (real bundled main/preload, renderer recovery and native main crash/dumps).
- The Wave CLI accepted the production log format, ignored a partial line and deduplicated repeated log input.
- The deterministic identity evaluation removed the known-recording alias in all six modes while retaining both fresh recordings. This is synthetic regression evidence only.

Logs and built outputs remain in ignored scratch/dist directories; no commit or release was created.
