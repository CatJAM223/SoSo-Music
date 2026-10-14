# Desktop performance changes in 3.1.0

Measured locally on Windows on 2026-10-14, comparing the previous 3.1.0 test build with this revision.

| Check | Previous behavior | Current behavior |
| --- | --- | --- |
| JavaScript actually requested by the overlay | 1,029,778 bytes | 254,751 bytes (75.3% less) |
| 121 state updates with unchanged track metadata | Every update forwarded | One update forwarded |
| Updates forwarded to a hidden overlay | Forwarded | None; newest track sent when shown |
| Overlay disabled | No permanent off setting | Window destroyed and overlay shortcut released |

The JavaScript measurement uses completed file requests in Electron, including shared chunks. It is **not** a percentage reduction in total player RAM. Chromium, GPU resources and the main player still have their own memory costs.

The overlay now loads without importing the main player, audio engine, HLS library or recommendation code. Its visible metadata is sent only when the track ID, title, artist or displayed cover changes. Hiding and showing it preserves the latest track; changing its position and click-through behavior remain available.

The normal player's providers and initialization are preserved in a separate module. Existing playback-related background settings were retained to avoid introducing stutters while the main window is minimized. No optimization dependency was added.

Validation: 982 Node regressions; Electron UI scenarios for single-key and two-key recording, cancellation/reset, the integrations switch, all 12 onboarding steps, queue behavior and update notices; native Windows registration of F24 and Shift+F24; production main/renderer startup with real keyboard events; real-audio transition and buffering scenarios; settings subscription/timer cleanup.

Official guidance: [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance).
