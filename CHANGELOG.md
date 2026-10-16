# Changelog

### [3.1.5]

- Recover removed saved SoundCloud recordings through bounded matching in the same service, preserving library IDs.
- Preserve the signed-in YouTube watch parser in production builds, retry internal client bootstrap once and distinguish preparation errors from network failures.

- Daily recommendations remember artist rejection from two distinct disliked songs, reduce priority after one, and refresh cached picks when dislikes change.
- Bounded stream retries with Retry-After and cancellable shared stream requests.
- Paged library search, virtual card grids and complete playback queues.
- Reversible track and playlist exclusions from the taste profile, independent of dislikes.
- Stable identities for repeated queue entries and bounded recovery from stalled playback.

### [3.1.0]

- Preserve disabled overlay settings when other preferences are damaged; cancel delayed shortcut recording on blur; allow Esc to leave position editing after a failed save; recover artwork through bounded fallback URLs.
- Support single-key and two-key shortcuts, an overlay on/off choice in integrations and onboarding, and fewer background overlay updates.
- Global configurable shortcuts for playback and a transparent, click-through track overlay with a separate position editor and compact keycap settings.
- Background GitHub release checks with a minimal update announcement that preserves playback.
- Language selection moved to Appearance.
- My Wave spaces liked recordings between other available songs, including across batch boundaries.
- Queue fits below the title bar, keeps the current track visible, and offers clearer rows and compact track actions.

### [3.0.5]

- English and Russian interface with a persistent RU/EN switch in Settings.
- Optional Last.fm API key stored locally, with setup links in Settings and the introductory tour.
- Bilingual project documentation and a refreshed introductory tour.
- Consistent My Wave button and queue: feedback and background refill preserve the announced next track.
- Clearer queue display without redundant repeat labels.
- More distinct wave modes, less repeated exposure and a Last.fm library genre profile.
- Bounded stream recovery, clearer playback logs and less background work.

Earlier notes are preserved in the [Russian development history](docs/changelog-archive.ru.md). These notes describe local source changes; see [GitHub Releases](https://github.com/CatJAM223/SoSo-Music/releases) for published packages.
