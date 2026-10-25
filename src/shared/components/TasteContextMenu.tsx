import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { useLocale } from '../i18n/useLocale';
import { t } from '../i18n/locale';
import { useTastePolicy, setTasteExcluded } from '../hooks/useTastePolicy';
import { tasteContextId, tasteTrackId } from '../utils/tastePolicy';
import type { TasteExclusionScope } from '../types/tastePolicy';
export function TasteContextMenu({
  scope,
  id,
  label,
  onAdd,
}: {
  scope: TasteExclusionScope;
  id: string | number;
  label: string;
  onAdd?: () => void;
}) {
  useLocale();
  const policy = useTastePolicy(),
    key = scope === 'track' ? tasteTrackId(id) : tasteContextId(id);
  const excluded = policy.exclusions.some((row) => row.scope === scope && row.id === key);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const popup = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const rect = button.current?.getBoundingClientRect();
    if (rect)
      setPosition({
        left: Math.max(8, Math.min(rect.right - 256, window.innerWidth - 264)),
        top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 200)),
      });
    popup.current?.querySelector('button')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !popup.current?.contains(event.target as Node) &&
        !button.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const close = () => setOpen(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  const action = excluded ? t('Снова учитывать во вкусе') : t('Не учитывать во вкусе');
  return (
    <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
      <button
        ref={button}
        type="button"
        aria-label={t('Настройки вкуса')}
        aria-expanded={open}
        title={excluded ? t('Исключено из профиля вкуса') : t('Настройки вкуса')}
        className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-zinc-700"
        onClick={() => {
          setOpen((value) => !value);
          setError('');
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            role="group"
            aria-label={t('Настройки вкуса')}
            style={{
              position: 'fixed',
              left: position.left,
              top: position.top,
              zIndex: 10000,
              width: 256,
              maxHeight: 'calc(100vh - 16px)',
              overflowY: 'auto',
            }}
            onClick={(event) => event.stopPropagation()}
            className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 shadow-xl"
          >
            {onAdd && (
              <button
                type="button"
                className="w-full text-left rounded-lg p-2 text-sm hover:bg-slate-100 dark:hover:bg-zinc-800 focus-visible:bg-slate-100 dark:focus-visible:bg-zinc-800"
                onClick={() => {
                  setOpen(false);
                  onAdd();
                }}
              >
                {t('Добавить в плейлист')}
              </button>
            )}
            <button
              type="button"
              disabled={busy || policy.revision < 0 || !key}
              aria-pressed={excluded}
              className="w-full text-left rounded-lg p-2 text-sm hover:bg-slate-100 dark:hover:bg-zinc-800 focus-visible:bg-slate-100 dark:focus-visible:bg-zinc-800 disabled:opacity-50"
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await setTasteExcluded({ scope, id: key, label, excluded: !excluded });
                  if (mounted.current) {
                    setOpen(false);
                    button.current?.focus();
                  }
                } catch {
                  if (mounted.current) setError(t('Не удалось изменить настройку вкуса.'));
                } finally {
                  if (mounted.current) setBusy(false);
                }
              }}
            >
              {action}
            </button>
            {error && (
              <p role="alert" className="p-2 text-xs text-red-500">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
