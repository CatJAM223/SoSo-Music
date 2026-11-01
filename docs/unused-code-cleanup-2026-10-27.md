# Удаление неиспользуемого кода — 27.10.2026

Выполнен первый этап по результатам статического аудита. Удаления ограничены подтверждённо неподключёнными модулями и объявлениями без вызовов из приложения.

## Удалённые модули

- `src/shared/components/ListeningStatsPanel.tsx` — неподключённая панель и её локальные компоненты. Рабочая статистика остаётся в `shared/components/settings/SettingsStats.tsx`.
- `src/shared/utils/trackShare.ts` — утилита шаринга без потребителей.
- `src/shared/utils/popoverPosition.ts` — помощник позиционирования, который вызывался только из отдельного теста.

## Удалённые объявления

Всего удалены 23 объявления, не считая содержимого трёх модулей выше:

Суммарное сокращение исходников `src` — около 840 строк, включая комментарии и пустые строки.

| Файл                                            | Объявления                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `desktop/main/services/lastfm.ts`               | `getAlbumInfo`                                                                                  |
| `desktop/main/services/musicAggregator.ts`      | `mergeArtistTracks`                                                                             |
| `desktop/main/services/soundcloud.ts`           | `findBestTrackMatch`, `resolveTrackAlbums`, `getGenreList`, `getAlbum`, `hydratePlaylistTracks` |
| `desktop/main/services/waveEngine.ts`           | `SUPPORTED_WAVE_MOODS`, `filterWaveTracks`                                                      |
| `desktop/main/services/youtubeMusic.ts`         | `getVideoDuration`, `isDurationAcceptable`                                                      |
| `shared/services/parsers/youtubeMusicParser.ts` | `isDurationClose`, после удаления его единственного production-потребителя                      |
| `shared/services/parsers/soundCloudParser.ts`   | `cleanArtistForSearch`                                                                          |
| `shared/services/songsterrService.ts`           | Статическая обёртка `formatTuning`                                                              |
| `shared/services/offlineCacheService.ts`        | `formatCacheSizeBytes`                                                                          |
| `shared/utils/waveQueue.ts`                     | `moveDifferentArtistAfterSkip`                                                                  |
| `shared/utils/playbackQueueOrder.ts`            | `upcomingQueueIndices`                                                                          |
| `shared/utils/crossfade.ts`                     | `clampCrossfadeDuration`                                                                        |
| `shared/utils/libraryTaste.ts`                  | `LIBRARY_GENRE_MIN_SCORE`, `LIBRARY_GENRE_MAX_SCORE`                                            |
| `shared/context/themeData.ts`                   | `getEffectiveThemeMode`, `getWeatherThemePalette`                                               |
| `shared/bridge/platformBridge.ts`               | `isElectron`                                                                                    |

Изменения не добавляют второй реализации алгоритмов. Рабочая дедупликация продолжает вызывать Rust. Standalone-обёртки Rust, изменение ABI и отключённая адаптивная тема относятся к отдельному разбору.

## Как пересмотрены тесты

- Два теста старого объединения каталогов переведены на `cleanDiscoveryTracks`, который используется подборками и выполняет сравнение в Rust. Учитывается его фактический контракт: первая запись семейства песни сохраняется, повторные версии исключаются, несвязанные песни остаются.
- Проверка запрета SoundCloud `BLOCK` / `SUB_HIGH_TIER` переведена на рабочий `transformSCTrack`.
- Границы очереди проверяются через `prefetchQueueIndices`, которым действительно пользуется плеер.
- Вместо отдельного неиспользуемого clamp проверяется `useAudioSettings`: ограничение кроссфейда, синхронизация state/ref, сохранение и восстановление настройки.
- Форматирование строя проверяется через `formatSongsterrTuning`, который используется при подготовке реальных данных Songsterr.
- Проверки длительности YouTube читают существующий кэш. Сам кэш сохранён: `getFullStreamUrl` использует его для уточнения длительности трека.
- Удалены десять отдельных тестов устаревших путей и добавлена проверка действующего hook настроек. Остальные изменённые проверки перенаправлены на рабочие реализации. Регрессии настоящего каталога, подстановки доступной записи, отмены и воспроизведения сохранены.

## Что сохранено

- Диагностические методы базы, кэша и нормализации.
- Исторические эталоны в изолированных `tests/fixtures`.
- Динамические импорты, Workers, AudioWorklet и CLI отчёта о воспроизведении.
- Обязательные host-экспорты Rust ABI 5 и их совместимые TS-обёртки.
- Намеренные платформенные реэкспорты, отключённый контракт адаптивной темы и парсер LAN-сопряжения.
- Данные пользователя, миграции и форматы резервных копий.

## Проверки

Production renderer/main/preload собраны. Все 26 групп `npm run test:all` прошли, включая 1240 из 1240 Node-тестов, TypeScript, границы модулей, форматирование, интерфейс, аудио, Rust и проверки чувствительности к намеренным поломкам.

Дополнительно прошёл `npm run test:production`: собранный YouTube-клиент, настоящий production main/preload, восстановление renderer после сбоя и перезапуск после нативного сбоя main с локальными дампами. Удалённые сервисные методы отсутствуют в новом `dist-electron/main.js`.

Стенды используют отдельные профили и локальные данные. Результаты не подтверждают доступность живых музыкальных сервисов или вход конкретного аккаунта.
