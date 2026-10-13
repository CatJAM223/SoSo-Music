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

## Reporting bugs

Include the app version, Windows version, exact steps and relevant log lines. Do not attach cookies, tokens, pairing codes or a full personal database. Mocked tests cannot establish external service availability or successful real account sign-in.
