# Playback and artist catalog recovery

## Reported recordings

- ThxSoMch — Hate.: original upload SYq87_TD2HE returned UNPLAYABLE in a direct public watch-page request. The matching official video Ama40Tk-_rM remained available.
- Don Toliver — No Idea: original upload ZkJHEUKtvXI returned UNPLAYABLE. Matching official audio FC_iFNoJWGU remained available.

The player now recovers only after a definitive unavailable response, within YouTube, using the same title/artist/recording duration. Alternate mixes and different performers are rejected. Saved library IDs are retained. Access challenges, temporary transport failures, paid content and downloads retain their existing behavior.

In a separate profile through the real built main/preload and Electron decoder, Hate. advanced to 0.645 s with duration 141.595 s; No Idea advanced to 0.672 s with duration 153.461 s. Both had a null media error. This confirms decoder startup; full-track listening and all provider recordings were not measured.

## Catalog changes

- Preserve the selected service when artist resolution fails.
- Clear previous artist data and loading state on navigation; retain known preview tracks while the full catalog loads.
- Follow release/playlist/album continuations and include artist-owned video shelves; remove the arbitrary ten-album cap.
- Share bounded profile lookups between preview and complete-catalog loads.
- Match searched tracks to the requested artist and avoid selecting arbitrary similarly named profiles.
- Hydrate SoundCloud album stubs and use recording/release IDs for album membership and grouping.
- Preserve provider ranking within search result groups.

Live public YouTube responses initially produced 13 Don Toliver releases; following the continuation produced 26. The expanded ThxSoMch catalog included the available official Hate. video. These counts depend on current provider availability and region.

Some SoundCloud originals (including Pain. and screws) currently return policy BLOCK with no audio renditions. The implementation retains this provider restriction and does not switch the artist catalog to YouTube.

The Windows build includes TypeScript checking. No formal test suite was run for this follow-up; the evidence above comes from live provider responses and isolated decoder diagnostics.
