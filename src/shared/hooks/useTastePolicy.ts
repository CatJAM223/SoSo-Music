import { useSyncExternalStore } from 'react';
import type { TasteExclusionChange, TastePolicySnapshot } from '../types/tastePolicy.ts';
import { platformBridge } from '../bridge/platformBridge.ts';
let policy: TastePolicySnapshot = { revision: -1, exclusions: [] };
const listeners = new Set<() => void>();
let listening = false;
let pending: Promise<TastePolicySnapshot> | undefined;
function accept(value: TastePolicySnapshot): TastePolicySnapshot {
  if (value.revision < policy.revision) return policy;
  const changed = value.revision !== policy.revision;
  policy = value;
  if (changed) {
    listeners.forEach((listener) => listener());
    if (typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent('soso:taste-policy-changed', { detail: value }));
  }
  return policy;
}
export function readTastePolicy(): TastePolicySnapshot {
  return policy;
}
export function refreshTastePolicy(): Promise<TastePolicySnapshot> {
  if (!pending)
    pending = platformBridge
      .getTastePolicy()
      .then(accept)
      .finally(() => {
        pending = undefined;
      });
  return pending;
}
export async function setTasteExcluded(value: TasteExclusionChange): Promise<TastePolicySnapshot> {
  return accept(await platformBridge.setTasteExcluded(value));
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!listening) {
    listening = true;
    platformBridge.onTastePolicyChanged(accept);
  }
  void refreshTastePolicy().catch(() => {});
  return () => {
    listeners.delete(listener);
  };
}
export function useTastePolicy() {
  return useSyncExternalStore(subscribe, readTastePolicy, readTastePolicy);
}
