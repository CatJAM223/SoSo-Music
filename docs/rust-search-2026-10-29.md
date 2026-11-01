# Rust search ranking — 2026-10-29

## Scope and priority

The next migrated computation is search ranking, used by MusicAggregatorService and progressive search results. The former TypeScript scorer was removed from production. `native/compute-core/src/search.rs` now owns score arithmetic, source/duration bonuses, query-controlled penalties, first-occurrence duplicate suppression and stable ordering. `src/shared/utils/searchRanking.ts` prepares textual predicates using existing artist/title matching and JavaScript regex/Unicode semantics, sends one numeric batch and maps returned indices to original Track objects. There is no JavaScript scoring fallback.

Metadata preparation uses invocation-local artist/title caches. This avoids repeatedly normalizing the same artist and evaluating the same noise expressions. These caches are released at the end of each ranking call and contain no shared request state. The duplicate identity definition, first-encountered provider preference and tie order remain the same. Textual matching rules were deliberately preserved, including their existing limitations.

The shared compute interface is ABI 7. Initialization requires rank_search and rejects old/missing modules. Both generated artifact fingerprints and tests include the new Rust source. Packets are bounded to 8 MiB and 65,536 candidates; malformed/nonfinite numeric data, out-of-range flags and invalid record counts are rejected. This is above normal search batches. Rust has no imported host capabilities.

The old algorithm exists only in `tests/fixtures/searchRankingBeforeRust.mjs`, as a frozen regression/benchmark oracle. It is not imported by application code.

## Measurements

`npm run bench:search` records 31 alternating paired warm samples, with five complete ranking calls per sample. Encoding, WASM invocation, copying and index mapping are included; initialization and provider latency are excluded. The inputs are synthetic. The final benchmark was run after other verification processes finished. It compares the old production algorithm against the migration including local metadata caches; the effect must not be attributed to Rust alone.

See `benchmarks/rust-search-2026-10-29.json`:

| Candidates | Query | Metadata | Old median ms | Current median ms | Old/current |
| ---: | --- | --- | ---: | ---: | ---: |
| 30 | love | Repeated fields | 0.0643 | 0.0658 | 0.98× |
| 200 | love | Repeated fields | 0.4007 | 0.2990 | 1.34× |
| 200 | artist - title | Repeated fields | 1.1160 | 0.4526 | 2.47× |
| 2000 | artist - title | Repeated fields | 10.7912 | 3.2857 | 3.28× |
| 2000 | love | Distinct fields | 4.0732 | 4.5070 | 0.90× |
| 2000 | artist - title | Distinct fields | 11.5657 | 9.1360 | 1.27× |

There is no general search/network/UI speedup claim. Small simple queries show no measurable benefit; a simple query over unique metadata is about 11% slower in this fixture. Text preparation still dominates some workloads. Further work should profile that preparation rather than moving provider HTTP calls to Rust merely because they are written in TypeScript.

## Validation

- 600 complete-order differential comparisons, covering Unicode, punctuation, duplicate metadata, split/reverse queries, empty queries, noise exemptions and different sources/durations. Input order and returned object identity are preserved.
- Malformed WASM packet rejection and successful reuse after errors; native Rust packet/tie/dedup tests.
- 1,255 Node tests passed. The quit-lifecycle VM fixture was updated to include the already-existing listeningRooms service so its checks exercise current production cleanup.
- Production CSP Chromium check passed, including the new search implementation against the reference and existing Wave/Worker checks for all six modes.
- TypeScript and architecture checks passed.

Only the compute WASM/test artifacts were rebuilt. No desktop package was created or copied to the desktop.
