# Genres and charts in 3.3.0

## Current product scope

The user subsequently requested region selection and no further builds. The current source includes Worldwide and 19 supported countries (`src/shared/utils/chartRegions.ts`), with persisted selection and IPC validation. Worldwide retains its established official song playlist. Regional rankings use the official Charts client request (`CHART_DETAILS`, `TRACKS`, `WEEKLY`) and verify the returned country/type. Metadata is loaded in batches of 50 using the exact official studio/video IDs; rows without a verified duration or usable metadata are excluded, preserving original rank numbers. No arbitrary search or different-country fallback is used. Region rankings have a bounded five-minute metadata cache. UI headings have no captions; the genre heading icon is removed. Only TypeScript checking and read-only public-provider diagnostics were performed for this iteration; no new application/Rust build was produced.

Live diagnostic reads in `scratch/regional-song-charts-live.log` returned 50 eligible recordings each for Russia, US, Japan and South Korea. The initial global diagnostic exercised the analytics route; the final global route retains the previous official playlist. These reads establish catalog loading, not complete playback or UI interaction verification.

At the user's request, the Charts section now uses only the official global YouTube Music song chart. The source switcher, SoundCloud chart method, mixed-source aggregation and service-source argument have been removed from the renderer, shared bridge, preload and main handler. The empty-user Home preview uses this same YouTube-only route. Original provider ranking positions remain visible. SoundCloud's genre playlists are used only in genre browsing.

The SoundCloud chart restoration and combined-mode observations below document the earlier investigation and are superseded for the Charts section. The latest production build log is `scratch/youtube-only-charts-build.log`.

## Findings

- YouTube changed its playlist browse layout. The old two hardcoded shelf paths found no rows and silently searched `Top Hits 2025 2026` instead. Keyword search is not a ranked chart and can return long compilations.
- The previous playlist, `PL4fGSI1pDJn6cLcPmcc9b_l8oM0aJtsqL`, identifies itself as Russia Top 100 music videos, despite the old code comment claiming a global song chart.
- The retired global and genre SoundCloud chart API and legacy chart/discover web URLs returned HTTP 404. The initial change stopped there prematurely. Further investigation found the current verified Music Charts account and its maintained public playlists: `music-charts-us/sets/all-music-genres`, published playlist ID `1714689261`, owner `1319568996`. Its recorded last update was 2026-10-22.
- Combined charts had no song deduplication. SoundCloud genre charts were trusted without checking matching genre metadata, and broad aliases such as `house`, `rave`, and `90s` admitted other genres.
- Genre source buttons filtered an already merged/deduplicated result. A song retained from YouTube could consequently disappear when selecting SoundCloud.

## Changes

- Use the official global song chart, `PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i`, preserving provider order. In the combined selection, alternate the two provider rankings and remove duplicates; this is not a single official cross-service ranking.
- Read playlist shelves through the catalog layout parser. Chart and genre song parsing requires an actual duration; ordinary search retains its existing estimate for missing durations.
- Automated lists accept songs lasting 40–900 seconds, reject unavailable tracks, mixes, compilations, podcasts, karaoke, covers and common speed edits, and collapse recording families/reuploads. These restrictions apply to automated discovery, not library playback or normal search.
- SoundCloud genre results, including chart entries, require matching explicit genre/tag metadata. Broad category aliases were narrowed. User-supplied tags can still be inaccurate.
- YouTube genre discovery uses only Songs search, curated genre artist pools and exact normalized credited artist matching. This is an editorial genre selection; an artist can work in several genres, so it is not a per-song acoustic classifier.
- Fetch and cache each genre/source separately for five minutes. Ignore superseded requests; provide a refresh control.
- SoundCloud charts now load the published US chart using its canonical permalink and verify the owner ID, account permalink, verification badge and playlist slug. Resolve and hydrate track stubs in original order; retain individual album metadata. Reuse pending chart requests and cache successful responses for five minutes. Corresponding genre charts use these published playlists with the same strict per-track genre check.
- Preserve original chart positions before filtering. Source-specific lists display those positions; combined lists display their own sequence numbers. The SoundCloud region is explicitly US.
- Chart errors are exposed as unavailable sources. Do not substitute arbitrary keyword search or another source in a source-specific view. Successful SoundCloud charts have a five-minute cache; failures are not cached.

## Observed results

Public-provider diagnostics are stored under ignored `scratch/genre-charts-live.*` and `scratch/genre-charts-live-results.json`. The global YouTube chart returned 50 songs with a maximum duration of 358 seconds. This initial run reported SoundCloud unavailable because only the legacy endpoint had been investigated. That was incomplete and is superseded by the restored-source diagnostics below. Initial live genre examples (Phonk, Alternative Rock, Deep House, Neoclassical and Eurodance) returned 56–61 songs, with no duration exceeding the configured ceiling.

The restored SoundCloud loader and aggregator returned 5 available-format chart tracks from the published 48-entry playlist; combined mode returned 50 tracks (45 YouTube, 5 SoundCloud) without an unavailable-source warning. The raw playlist exposed 35 `BLOCK` and 3 `SNIP` entries; some remaining full tracks expose only unsupported encrypted protocols. Those recordings remain excluded rather than being replaced by unrelated search results. This is metadata availability, not a full playback listening check. Restored-source snapshots: `scratch/soundcloud-current-charts.log`, `scratch/soundcloud-charts-restored.log` and `scratch/soundcloud-charts-restored.json`.

TypeScript compilation and production packaging are recorded in `scratch/genres-charts-build.log` and `scratch/soundcloud-charts-build.log`. No formal test suite was added or run for this follow-up.

References:
- [YouTube Charts criteria](https://support.google.com/youtubemusic/answer/9014376?hl=en)
- [Official global song playlist](https://music.youtube.com/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i)
- [Published SoundCloud US all-genre chart](https://soundcloud.com/music-charts-us/sets/all-music-genres)
- [SoundCloud API guide](https://developers.soundcloud.com/docs/)
