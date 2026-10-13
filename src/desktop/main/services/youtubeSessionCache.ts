import type { Session } from 'electron';

/** Clear the YouTube browser session, leaving IndexedDB, app storage and audio files intact. */
export async function clearYouTubeSessionCache(
  browserSession: Pick<Session, 'clearCache' | 'clearStorageData' | 'forceReloadProxyConfig'>,
): Promise<void> {
  await browserSession.clearCache();
  for (const origin of ['https://www.youtube.com', 'https://music.youtube.com']) {
    await browserSession.clearStorageData({ origin, storages: ['cookies', 'cachestorage'] });
  }
  await browserSession.forceReloadProxyConfig();
}
