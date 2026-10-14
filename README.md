<div align="center">
  <img src="src/renderer/assets/icon.png" width="96" height="96" alt="SoSo Music icon">
  <h1>SoSo Music</h1>
  <p>Your favorites, new discoveries and lyrics. Together in a Windows music player.</p>
  <p><a href="https://github.com/CatJAM223/SoSo-Music/releases">Download</a> · <a href="README.ru.md">Русский</a> · <a href="https://github.com/CatJAM223/SoSo-Music/issues">Report an issue</a></p>
  <p><img src="https://img.shields.io/badge/Windows-x64-0078D4" alt="Windows x64"> <img src="https://img.shields.io/badge/version-3.1.0-eab308" alt="Version 3.1.0"> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license"></a></p>
</div>

Search SoundCloud and YouTube Music, build a personal library, and let **My Wave** find your next track. Switch between listening, karaoke and guitar practice without leaving the player.

[Features](#features) · [Install](#install) · [Quick start](#quick-start) · [Development](#development) · [Troubleshooting](#troubleshooting)

## Features

- **Two music catalogs.** Search tracks, artists and albums on SoundCloud and YouTube Music.
- **My Wave.** Flow, Energy, Chill, Discover and Mix respond to likes, skips and listening history. Choose one catalog or combine both sources.
- **Your library.** Liked tracks, playlists, saved albums, followed artists and listening statistics. Import public playlists from Yandex Music or VK Music and review matches before saving.
- **Lyrics and guitar.** Synchronized karaoke, chord diagrams, Songsterr tabs and official music videos where available.
- **Comfortable playback.** Crossfade, volume normalization, sleep timer, previews, queue controls and automatic recovery from temporary stream failures.
- **Offline listening.** Download available tracks and artwork. Search and new streams still require an internet connection.
- **Make it yours.** Themes, accent colors, animated backgrounds and video wallpapers. Russian and English interface, selectable in Settings.
- **Desktop integration.** Media keys, tray controls, a mini widget and optional Discord Rich Presence. Transfer library metadata to the companion phone app over local Wi-Fi.

## Install

1. Open [GitHub Releases](https://github.com/CatJAM223/SoSo-Music/releases) and choose a Windows x64 ZIP.
2. Extract the **entire archive** into a writable folder.
3. Run **SoSo Music.exe** inside the extracted application folder (usually `win-unpacked`). Keep its resources and DLLs alongside it.

The current distribution is a portable Windows build. Moving only the executable will break it. Downloadable builds are distributed through Releases, separately from the source repository.

## Quick start

- Search for music and select the heart beside tracks you enjoy. Add playlists and follow artists to build your library.
- Open **My Wave** and use the gear button to choose a mode and music source.
- Change the interface language using **RU / EN** in **Settings → Appearance**. The choice is remembered and applies immediately.
- Add your own Last.fm API key in **Settings → Integrations** using the [Get a Last.fm key](https://www.last.fm/api/account/create) link, then visit **Settings → Statistics** to analyze genres. The key stays in local application settings and is excluded from source code, builds and library exports. This optional analysis sends track titles and artist names to Last.fm; liked tracks carry more weight. [How the taste profile works](docs/library-taste.md).
- Use the lyrics button for karaoke and guitar. Repeat the introductory tour from **Settings → Appearance**.

**Overlay and shortcuts:** open **Settings → Keyboard shortcuts**. Defaults: **Ctrl+Shift+Space** shows/hides the overlay; **Ctrl+Alt+Right/Left** changes tracks; **Ctrl+Alt+Space** pauses/resumes. The overlay shows artwork, track title and artist on a transparent background; all clicks pass through. Use **Adjust position** in settings to move the card, then choose **Done**. The position and custom shortcuts are saved locally. For games, use windowed or borderless mode; exclusive fullscreen may hide the overlay.

**Updates:** the running app checks stable GitHub Releases about every 90 seconds and shows the new version without interrupting playback. Later dismisses that version; downloading opens its release page. Network failures and rate limits reduce check frequency. Existing 3.0.5 builds require a manual check to obtain this feature.

The player restores your last track, position and queue. Playback resumes when you press Play.

### Accounts and library transfer

YouTube may request sign-in or verification. Connect an account in **Settings → Integrations**. **Refresh session** keeps your sign-in and requests fresh stream data. A YouTube Data API key is optional and used for official video search, not ordinary music playback.

To transfer a library, open **Settings → Data → Sync** on your PC and scan the QR code in the companion phone app on the same local network. The transfer carries library metadata, not audio files or account cookies. JSON library backup and restore are also available in Settings.

## Development

### Requirements

- Windows for developing and packaging the desktop app.
- **Node.js 24+** and npm.
- Stable Rust with the **wasm32-unknown-unknown** target for the local compute module.

```powershell
rustup target add wasm32-unknown-unknown
npm ci
npm run dev
```

In PowerShell, use `npm.cmd` if your execution policy blocks `npm.ps1`.

### Build

```powershell
npm run build
npm run package:zip
```

The unpacked app is written to `release/win-unpacked/`. ZIP packaging checks the packaged version, creates a SHA-256 checksum and refuses to overwrite an existing archive.

### Checks

| Command                          | Purpose                                          |
| -------------------------------- | ------------------------------------------------ |
| `npm run lint`                   | TypeScript type checking                         |
| `npm run format:check`           | Formatting                                       |
| `npm run architecture:check`     | Main, preload and renderer dependency boundaries |
| `npm test`                       | Node regression tests and Rust/WASM preparation  |
| `npm run test:desktop-ui`        | Electron UI scenarios, settings and onboarding   |
| `npm run test:player-state`      | Player state and lifecycle checks                |
| `npm run test:audio-transitions` | Real audio transitions                           |
| `npm run test:ui-performance`    | Large library responsiveness                     |
| `npm run release:check`          | Version and release metadata consistency         |
| `npm run test:all`               | Complete local validation suite                  |

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Some checks launch Electron and require a desktop session. Test outputs and local builds go into ignored folders.

### CI and releases

GitHub Actions checks formatting, types, architecture and regression tests when code or configuration changes. Documentation-only and empty pushes do not start CI; newer runs cancel outdated ones.

Use the **Windows release** workflow manually to download a build artifact, or push a tag matching the package version (for example, v3.1.0) to build and publish a GitHub Release with its ZIP and SHA-256 checksum. Desktop builds are not produced for every commit.

### Project layout

```text
src/desktop/main/   Electron services, SQLite storage and IPC handlers
src/desktop/ui/     Windows screens and components
src/renderer/      Renderer entry point and global styles
src/shared/        Player logic, components, contracts and localization
native/            Rust/WASM compute sources
public/            Runtime assets and bundled font licenses
scripts/           Build, release and verification tools
tests/             Regression tests and fixtures
docs/              Focused technical documentation
```

Built with Electron, React, TypeScript, Vite, SQLite (sql.js), Rust/WASM and hls.js. Lyrics and metadata depend on external services. The local compute module has a JavaScript fallback.

## Troubleshooting

| Symptom                        | What to try                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A track is waiting to load     | Temporary failures retry automatically while keeping your position. Check your connection if waiting continues.                                             |
| YouTube requests verification  | Open its account window in Integrations and finish verification. Try Refresh session if already connected. Google may restrict sign-in in embedded windows. |
| No results from a catalog      | Check the connection and try another source. Availability depends on the provider and region.                                                               |
| The packaged app will not open | Extract the entire ZIP and keep all application resources together.                                                                                         |
| A build fails with EPERM       | Close processes using build output files, then retry.                                                                                                       |

[Report a bug](https://github.com/CatJAM223/SoSo-Music/issues) with the app version, Windows version, reproduction steps, expected behavior and relevant log lines from **Settings → Data → Open logs**. Remove cookies, tokens and pairing codes before sharing diagnostics.

## Contact

For ideas, bug reports, or contributions, contact **[@Jopanikita838](https://t.me/Jopanikita838)** on Telegram. You can also [open a GitHub issue](https://github.com/CatJAM223/SoSo-Music/issues).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for current changes and the preserved development history. Source changes and published releases may differ; downloadable packages are listed in Releases.

## License

Copyright **CatJAM223**. Released under the [MIT License](LICENSE); see also the [usage notice](USAGE_NOTICE.txt). Bundled font licenses are in [public/fonts](public/fonts). The player license does not grant rights to music or other third-party content.
