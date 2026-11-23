import type { AppUpdateStatus } from '../../../shared/types/index.ts';
import { runRustCompute } from '../../../shared/compute/rustCore.ts';
import {
  PROJECT_REPOSITORY,
  PROJECT_RELEASES_API,
} from '../../../shared/utils/projectRepository.ts';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
function releaseInfo(
  current: string,
  tag: string,
  body: unknown,
  unstable: boolean,
): {
  code: number;
  latestVersion?: string;
  releaseHighlights?: AppUpdateStatus['releaseHighlights'];
} {
  const encoder = new TextEncoder();
  const fields = [
    current,
    tag.length <= 128 ? tag : '',
    typeof body === 'string' ? body.slice(0, 64 * 1024) : '',
  ].map((field) => encoder.encode(field));
  const input = new Uint8Array(1 + fields.reduce((size, field) => size + 4 + field.length, 0));
  const packet = new DataView(input.buffer);
  input[0] = Number(unstable);
  let offset = 1;
  for (const field of fields) {
    packet.setUint32(offset, field.length, true);
    input.set(field, offset + 4);
    offset += 4 + field.length;
  }
  const output = runRustCompute('app_release', input);
  const code = output[0];
  if (code === 0 || code === 3) return { code };
  if (code !== 1 && code !== 2) throw new Error('Invalid release result');
  const reader = new DataView(output.buffer);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const strings: string[] = [];
  for (let start = 1; start < output.length;) {
    const size = reader.getUint32(start, true);
    const end = start + 4 + size;
    if (end > output.length || strings.length >= 5) throw new Error('Invalid release text packet');
    strings.push(decoder.decode(output.subarray(start + 4, end)));
    start = end;
  }
  const [latestVersion, summary, ...changes] = strings;
  if (!latestVersion) throw new Error('Missing release version');
  return { code, latestVersion, releaseHighlights: summary ? { summary, changes } : undefined };
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
      const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
      const { code, latestVersion, releaseHighlights } = releaseInfo(
        currentVersion,
        tag,
        release.body,
        Boolean(release.draft || release.prerelease),
      );
      if (code === 3)
        return {
          status: 'no-release',
          currentVersion,
          message: 'Стабильный релиз пока не опубликован.',
        };
      if (code === 0)
        return {
          status: 'error',
          currentVersion,
          message: 'Не удалось определить версию релиза. Используйте тег вида v3.0.0.',
        };
      if (code === 1)
        return {
          status: 'up-to-date',
          currentVersion,
          latestVersion,
          message: 'Установлена актуальная версия.',
        };
      // The backend constructs the release URL from validated version data.
      const releaseUrl = PROJECT_REPOSITORY + '/releases/tag/' + encodeURIComponent(tag);
      return {
        status: 'available',
        currentVersion,
        latestVersion,
        releaseUrl,
        ...(releaseHighlights && { releaseHighlights }),
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
