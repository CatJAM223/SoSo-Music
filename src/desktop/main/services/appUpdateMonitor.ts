import type { AppUpdateStatus } from '../../../shared/types/index.ts';
export const UPDATE_POLL_MS = 90_000;
/** One bounded request at a time; only published releases are notifications. */
export function startAppUpdateMonitor(
  check: () => Promise<AppUpdateStatus>,
  publish: (status: AppUpdateStatus) => void,
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (id: ReturnType<typeof setTimeout>) => void = clearTimeout,
) {
  let disposed = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    failures = 0;
  const poll = async () => {
    let delay = UPDATE_POLL_MS;
    try {
      const status = await check();
      if (disposed) return;
      if (status.status === 'error') {
        failures++;
        delay = Math.max(
          status.retryAfterMs || 0,
          Math.min(900_000, UPDATE_POLL_MS * 2 ** Math.min(failures, 4)),
        );
      } else {
        failures = 0;
        publish(status);
      }
    } catch {
      failures++;
      delay = Math.min(900_000, UPDATE_POLL_MS * 2 ** Math.min(failures, 4));
    }
    if (!disposed) {
      timer = schedule(() => {
        void poll();
      }, delay);
      timer.unref?.();
    }
  };
  timer = schedule(() => {
    void poll();
  }, 5000);
  timer.unref?.();
  return () => {
    disposed = true;
    if (timer !== undefined) cancel(timer);
  };
}
