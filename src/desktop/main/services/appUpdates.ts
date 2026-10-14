import type { AppUpdateStatus } from '../../../shared/types/index.ts';
import {
  PROJECT_REPOSITORY,
  PROJECT_RELEASES_API,
} from '../../../shared/utils/projectRepository.ts';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
function versionParts(value: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
export function compareReleaseVersion(latest: string, current: string): number | null {
  const a = versionParts(latest),
    b = versionParts(current);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index++)
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}
/** Read-only checker shared by manual checks and the background monitor; never installs. */
export function createAppUpdateChecker(currentVersion: string, fetcher: Fetcher) {
  let pending: Promise<AppUpdateStatus> | null = null;
  const run = async (): Promise<AppUpdateStatus> => {
    const signal = AbortSignal.timeout(15000);
    const init = {
      signal,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
    };
    try {
      const response = await fetcher(PROJECT_RELEASES_API, init);
      if (response.status === 404) {
        const repository = await fetcher(
          PROJECT_RELEASES_API.replace('/releases/latest', ''),
          init,
        );
        if (!repository.ok)
          return {
            status: 'error',
            currentVersion,
            message: 'Репозиторий недоступен. Проверьте соединение и публичный доступ на GitHub.',
          };
        return {
          status: 'no-release',
          currentVersion,
          message: 'В репозитории пока нет опубликованных релизов.',
        };
      }
      if (response.status === 403 || response.status === 429)
        return {
          status: 'error',
          currentVersion,
          message: 'GitHub временно ограничил запросы. Попробуйте позже.',
          retryAfterMs: Math.min(
            3_600_000,
            Math.max(
              90_000,
              response.headers.has('x-ratelimit-reset')
                ? Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now()
                : 900_000,
              Number(response.headers.get('retry-after')) * 1000 || 0,
            ),
          ),
        };
      if (!response.ok) throw Error('GitHub request failed');
      const release = await response.json();
      if (release.draft || release.prerelease)
        return {
          status: 'no-release',
          currentVersion,
          message: 'Стабильный релиз пока не опубликован.',
        };
      const comparison =
        typeof release.tag_name === 'string'
          ? compareReleaseVersion(release.tag_name, currentVersion)
          : null;
      if (comparison === null)
        return {
          status: 'error',
          currentVersion,
          message: 'Не удалось определить версию релиза. Используйте тег вида v3.0.0.',
        };
      const latestVersion = release.tag_name.replace(/^v/, '');
      if (comparison <= 0)
        return {
          status: 'up-to-date',
          currentVersion,
          latestVersion,
          message: 'Установлена актуальная версия.',
        };
      // The backend constructs the release URL from validated version data.
      const releaseUrl =
        PROJECT_REPOSITORY + '/releases/tag/' + encodeURIComponent(release.tag_name);
      return {
        status: 'available',
        currentVersion,
        latestVersion,
        releaseUrl,
        message: 'Доступна версия ' + latestVersion + '.',
      };
    } catch {
      return {
        status: 'error',
        currentVersion,
        message: 'Не удалось проверить обновления. Проверьте соединение и попробуйте снова.',
      };
    }
  };
  return () => {
    if (!pending)
      pending = run().finally(() => {
        pending = null;
      });
    return pending;
  };
}
