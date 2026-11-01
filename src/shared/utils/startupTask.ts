export const PLAYER_STARTUP_TIMEOUT_MS = 15000;

/** Bound fetching AND initialization; a late result cannot commit a timed-out startup. */
export async function runStartupTask<T>(
  load: (signal: AbortSignal) => Promise<T>,
  timeoutMs = PLAYER_STARTUP_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => load(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('PLAYER_STARTUP_TIMEOUT'));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
