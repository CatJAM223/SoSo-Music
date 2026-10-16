# Desktop performance changes in 3.1.0

Measured locally on Windows on 2026-10-14, comparing the previous 3.1.0 test build with this revision.

| Check                                           | Previous behavior        | Current behavior                               |
| ----------------------------------------------- | ------------------------ | ---------------------------------------------- |
| JavaScript actually requested by the overlay    | 1,029,778 bytes          | 256,043 bytes (75.1% less)                     |
| 121 state updates with unchanged track metadata | Every update forwarded   | One update forwarded                           |
| Updates forwarded to a hidden overlay           | Forwarded                | None; newest track sent when shown             |
| Overlay disabled                                | No permanent off setting | Window destroyed and overlay shortcut released |

The JavaScript measurement uses completed file requests in Electron, including shared chunks. It is **not** a percentage reduction in total player RAM. Chromium, GPU resources and the main player still have their own memory costs.

The overlay now loads without importing the main player, audio engine, HLS library or recommendation code. Its visible metadata is sent only when the track ID, title, artist or displayed cover changes. Hiding and showing it preserves the latest track; changing its position and click-through behavior remain available.

The normal player's providers and initialization are preserved in a separate module. Existing playback-related background settings were retained to avoid introducing stutters while the main window is minimized. No optimization dependency was added.

Validation: 984 Node regressions; Electron UI scenarios for single-key and two-key recording, cancellation/reset, the integrations switch, all 12 onboarding steps, queue behavior and update notices; native Windows registration of F24 and Shift+F24; production main/renderer startup with real keyboard events; real-audio transition and buffering scenarios; settings subscription/timer cleanup.

Official guidance: [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance).

## Additional desktop widget optimization

The desktop widget now uses a separate lazy renderer route. It keeps saved theme
settings while avoiding AudioProvider, HLS, the main application and recommendation
WASM initialization in its own renderer.

The previous packaged 3.1.0 startup import graph required 1,194,662 bytes of
JavaScript. The current production Electron probe requests five files totaling
271,663 bytes, matching the current import graph: 77.3% fewer startup JavaScript
bytes. This compares the previous package's dependency graph with current actual
file requests; it does not establish the same reduction in total RAM or latency.

The five-second progress correction interval now exists only while the widget is
open and music is playing. Closing the widget, pausing or unmounting releases it.
Discrete track updates for the overlay remain available.

Validation includes all 1,011 Node regressions and Electron checks for three
widget open/close cycles, remote playback buttons, seek, volume, favorites and
saved accent. The production probe performs no external network requests.
Run it after building with
`node scripts/testing/testWidgetResources.mjs --production`.

## Library taste snapshots

Reports, Wave metadata enrichment and completed automatic checks now reuse one
library snapshot while the database mutation generation stays unchanged.
Database saves advance that generation synchronously, including in-memory and
explicit save paths; database replacement has its own identity check.
Tag/preference writes also clear the store cache when saving fails.

A regression with 2,000 analyzed tracks performed 100 warm report/automatic-check/
Wave-enrichment rounds with zero SQLite queries and zero provider requests.
Live progress/errors, expired-tag manual refresh, cancelled analysis, likes,
playlist changes, imports, dislikes and restored databases have separate checks.
This is a reduction in repeated library work, not a percentage claim about
total RAM or overall player speed.
