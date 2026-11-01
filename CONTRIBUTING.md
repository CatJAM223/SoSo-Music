# Contributing

Start with setup and checks in [README.md](README.md). Describe the user-visible problem, resulting behavior and checks you ran.

For ideas, bug reports or help contributing, contact [@Jopanikita838 on Telegram](https://t.me/Jopanikita838).

Changes to main go through a pull request with at least one approving review from another contributor with write access. New commits dismiss previous approvals; resolve review discussions before merging. Direct pushes, force pushes and deletion of main are blocked, including for administrators. CODEOWNERS requests a maintainer review automatically.

## Before submitting

- Run type checking, formatting and the architecture check. Add a regression test for behavioral bugs and run relevant existing tests.
- For player changes, check cancellation, rapid track changes, queue edits and temporary failure recovery. A network failure must not become a negative taste signal.
- For UI changes, check Russian and English, keyboard navigation and narrow windows. Keep interface translations in src/shared/i18n. Never translate track titles, artist names or user content.
- Keep generated builds, logs, caches, database exports, credentials and temporary diagnostics out of the repository. Install dependencies from the lockfile.
- Update both READMEs when setup changes. Put release notes in CHANGELOG.md. Change versions using npm run release:version -- X.Y.Z, then run npm run release:check.

## Structure

Electron main owns native services. Preload exposes typed contracts; the renderer uses the shared bridge. Shared modules cannot depend on desktop implementations. npm run architecture:check verifies these boundaries.

## Moving computations to Rust

A migrated algorithm must have one production implementation, owned by Rust. Delete its former TypeScript implementation and unused callers in the same change. Do not retain a parallel TypeScript algorithm or a JavaScript fallback.

TypeScript may validate and prepare inputs, marshal data through the typed WASM adapter, manage transport and lifecycle, and map results back to application objects. Scalar and batched entry points must call the same Rust implementation. If metadata preparation or a decision rule is itself migrated, remove that rule from TypeScript too.

Historical reference implementations belong only in isolated test fixtures or benchmarks and must never enter the application dependency graph. Compare outputs and measure the complete adapter call, including packing and copying. Describe batching or reduced boundary overhead as such; claim an algorithm migration only when its production TypeScript implementation has actually been replaced.

## Reporting bugs

Include the app version, Windows version, exact steps and relevant log lines. Do not attach cookies, tokens, pairing codes or a full personal database. Mocked tests cannot establish external service availability or successful real account sign-in.

## TypeScript compiler and tooling API

The `tsc` command uses TypeScript 7 through `@typescript/native`. The `typescript` dependency aliases the official `@typescript/typescript6` compatibility package because architecture checks and regression fixtures use the compiler API that TypeScript 7 no longer exposes. Keep both dependencies when upgrading; `npm run lint` checks the application with the native compiler.
