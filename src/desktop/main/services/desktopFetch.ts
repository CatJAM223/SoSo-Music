// Keep catalog resolution and audio downloads on Electron's network stack.
// A local VPN proxy can give Node fetch and Chromium different exit IPs;
// media URLs resolved on one connection may then fail on the other.
let electronFetch: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
let networkRecovery: (() => Promise<void>) | null = null;
let pendingRecovery: Promise<void> | null = null;
let youtubeSessionReset: (() => Promise<void>) | null = null;

export function setYouTubeSessionReset(reset: (() => Promise<void>) | null): void {
  youtubeSessionReset = reset;
}
export async function resetDesktopYouTubeSession(): Promise<void> {
  if (youtubeSessionReset) await youtubeSessionReset();
}

export function setDesktopFetch(fetcher: typeof electronFetch): void {
  electronFetch = fetcher;
}

export function desktopFetch(url: string, init?: RequestInit): Promise<Response> {
  return electronFetch ? electronFetch(url, init) : fetch(url, init);
}

export function setDesktopNetworkRecovery(recover: typeof networkRecovery): void {
  networkRecovery = recover;
}

// Concurrent playback retries must not close connections opened by each other.
export function recoverDesktopNetwork(): Promise<void> {
  if (!networkRecovery) return Promise.resolve();
  if (!pendingRecovery) {
    pendingRecovery = Promise.resolve()
      .then(networkRecovery)
      .finally(() => {
        pendingRecovery = null;
      });
  }
  return pendingRecovery;
}
