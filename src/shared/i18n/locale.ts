import { english } from './en.ts';
export type Locale = 'ru' | 'en';
export const LANGUAGE_KEY = 'soso_language';
const listeners = new Set<() => void>();
function readLocale(): Locale {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}
let locale: Locale = readLocale();
export function getLocale(): Locale {
  return locale;
}
export function getIntlLocale(): string {
  return locale === 'en' ? 'en-US' : 'ru-RU';
}
function syncNativeLanguage() {
  if (typeof window !== 'undefined')
    void window.electronAPI?.setInterfaceLanguage?.(locale).catch(() => {});
}
function notify() {
  syncNativeLanguage();
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}
export function setLocale(next: Locale) {
  if (next !== 'ru' && next !== 'en') return;
  if (next === locale) return;
  locale = next;
  try {
    localStorage.setItem(LANGUAGE_KEY, next);
  } catch {}
  notify();
}
function onStorage(event: StorageEvent) {
  if (event.key === LANGUAGE_KEY || event.key === null) {
    const next = readLocale();
    if (next !== locale) {
      locale = next;
      notify();
    }
  }
}
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined')
    window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== 'undefined')
      window.removeEventListener('storage', onStorage);
  };
}
export function t(message: string, ...values: unknown[]): string {
  const key = message.trim().replace(/\s+/g, ' ');
  const translated =
    locale === 'en'
      ? !Object.prototype.hasOwnProperty.call(english, key)
        ? message
        : (message.match(/^\s*/)?.[0] || '') +
          english[key].trim() +
          (message.match(/\s*$/)?.[0] || '')
      : message;
  return translated.replace(/\{(\d+)\}/g, (match, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  );
}
if (typeof document !== 'undefined') document.documentElement.lang = locale;

syncNativeLanguage();
