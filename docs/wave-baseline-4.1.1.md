# Accepted Wave baseline — 4.1.1

Date: 2026-11-13

The user listened to the desktop 4.1.1 build and confirmed that My Wave is pleasant to listen to. Preserve this version as the accepted baseline for subsequent recommendation changes.

This checkpoint captures the whole current application, including the existing playback, account, offline, listening-room and appearance changes required to reproduce the desktop build. It is not a Wave-only patch.

## Behavior to preserve

- Likes, listening history and session feedback contribute to the taste profile.
- Multiple successful recordings can steer discovery toward the current session style; one song alone does not establish that preference.
- Session affinity is bounded and calculated in the Rust compute core.
- The shared player prepares the next audio element and can transfer its ready buffer into playback, with cancellation, startup deadlines and crossfade recovery.

## Verification recorded before this checkpoint

- 104 playback, cache, Wave and reliability tests passed.
- 7 Rust tests passed.
- 4 Electron audio-transition scenarios passed.
- Full 4.1.1 production build and release metadata check passed.
- The desktop copy's packaged version was verified as 4.1.1.

These checks do not establish live YouTube/HLS transition latency under every network condition. Learning which discovery sources work best and a user-facing novelty slider are not implemented in this checkpoint.

## Future changes

Use this version as the comparison point. Preserve the accepted listening experience, make focused changes, and evaluate recommendation changes against it before treating them as an improvement.
