// One budget follows the playback owner through URL lookup and source replacements.
const deadlines = new WeakMap<AbortSignal, number>();
export const PLAYBACK_STARTUP_BUDGET_MS = 20000;
export function remainingStartupBudget(signal: AbortSignal, now = Date.now()): number {
  let deadline = deadlines.get(signal);
  if (deadline === undefined) {
    deadline = now + PLAYBACK_STARTUP_BUDGET_MS;
    deadlines.set(signal, deadline);
  }
  return Math.max(0, deadline - now);
}
export function completeStartupBudget(signal: AbortSignal): void {
  deadlines.delete(signal);
}

export function inheritStartupBudget(previous: AbortSignal, next: AbortSignal): void {
  const deadline = deadlines.get(previous);
  if (deadline !== undefined) deadlines.set(next, deadline);
}
