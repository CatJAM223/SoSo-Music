import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, GripHorizontal } from 'lucide-react';
import type { WidgetState } from '../../../shared/types';
import { DEFAULT_OVERLAY_LAYOUT, type OverlayLayout } from '../../../shared/utils/desktopControls';
import { DEFAULT_COVER_SVG_DATA_URI } from '../../../shared/utils/placeholder';
import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import './PlayerOverlay.css';
type Panel = keyof OverlayLayout;
export function PlayerOverlay() {
  useLocale();
  const [state, setState] = useState<WidgetState | null>(null);
  const [editing, setEditing] = useState(false);
  const editMode = useRef(false);
  const [layout, setLayout] = useState<OverlayLayout>(structuredClone(DEFAULT_OVERLAY_LAYOUT));
  const current = useRef(layout),
    revision = useRef(0);
  const drag = useRef<{
    panel: Panel;
    dx: number;
    dy: number;
    pointer: number;
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true,
      receivedState = false,
      receivedMode = false;
    const ticket = revision.current;
    const html = document.documentElement.style.background,
      body = document.body.style.background,
      overflow = document.body.style.overflow;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
    const changeMode = (value: boolean) => {
      editMode.current = value;
      if (!value) drag.current = null;
      if (active) setEditing(value);
    };
    const offMode = window.electronAPI?.onOverlayEditingChanged?.((value) => {
      receivedMode = true;
      changeMode(value);
    });
    void window.electronAPI
      ?.getOverlayEditing?.()
      .then((value) => {
        if (active && !receivedMode) changeMode(value);
      })
      .catch(() => {});
    const off = window.electronAPI?.onWidgetStateUpdate?.((value) => {
      receivedState = true;
      if (active) setState(value);
    });
    void window.electronAPI
      ?.getOverlayState?.()
      .then((value) => {
        if (active && value && !receivedState) setState(value);
      })
      .catch(() => {});
    void window.electronAPI
      ?.getOverlayLayout?.()
      .then((value) => {
        if (active && revision.current === ticket) {
          current.current = value;
          setLayout(value);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      off?.();
      offMode?.();
      editMode.current = false;
      document.documentElement.style.background = html;
      document.body.style.background = body;
      document.body.style.overflow = overflow;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const pointerMove = (event: PointerEvent) => {
      const value = drag.current;
      if (!editMode.current || !value || value.pointer !== event.pointerId) return;
      revision.current++;
      const next = {
        ...current.current,
        [value.panel]: {
          x: Math.max(
            0,
            Math.min(1, (event.clientX - value.dx) / Math.max(1, innerWidth - value.width)),
          ),
          y: Math.max(
            0,
            Math.min(1, (event.clientY - value.dy) / Math.max(1, innerHeight - value.height)),
          ),
        },
      };
      current.current = next;
      setLayout(next);
    };
    const pointerEnd = (event: PointerEvent) => {
      if (!drag.current || drag.current.pointer !== event.pointerId) return;
      drag.current = null;
      void window.electronAPI
        ?.saveOverlayLayout?.(current.current)
        .then(() => {
          if (active) setError('');
        })
        .catch(() => {
          if (active) setError(t('Не удалось сохранить положение оверлея.'));
        });
    };
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerEnd);
    window.addEventListener('pointercancel', pointerEnd);
    return () => {
      active = false;
      drag.current = null;
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerEnd);
      window.removeEventListener('pointercancel', pointerEnd);
    };
  }, []);
  function move(panel: Panel, x: number, y: number) {
    revision.current++;
    const next = {
      ...current.current,
      [panel]: { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) },
    };
    current.current = next;
    setLayout(next);
  }
  async function persist() {
    try {
      await window.electronAPI?.saveOverlayLayout?.(current.current);
      setError('');
    } catch {
      setError(t('Не удалось сохранить положение оверлея.'));
    }
  }
  function start(event: ReactPointerEvent<HTMLButtonElement>, panel: Panel) {
    if (!editMode.current || event.button !== 0) return;
    event.preventDefault();
    const rect = event.currentTarget.parentElement!.getBoundingClientRect();
    drag.current = {
      panel,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      pointer: event.pointerId,
      width: rect.width,
      height: rect.height,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Window listeners retain dragging on platforms without pointer capture. */
    }
  }
  const track = state?.track;
  async function finish() {
    try {
      await window.electronAPI?.saveOverlayLayout?.(current.current);
      await window.electronAPI?.finishOverlayEditing?.();
      editMode.current = false;
      drag.current = null;
      setEditing(false);
      setError('');
    } catch {
      setError(t('Не удалось сохранить положение оверлея.'));
    }
  }
  function handle(panel: Panel) {
    return (
      <button
        className="overlay-grip"
        autoFocus
        aria-label={t('Перетащить блок')}
        title={t('Перетащите блок или используйте стрелки')}
        onPointerDown={(event) => start(event, panel)}
        onKeyDown={(event) => {
          const directions: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          };
          if (!editMode.current) return;
          const direction = directions[event.key];
          if (!direction) return;
          event.preventDefault();
          const rect = event.currentTarget.parentElement!.getBoundingClientRect(),
            point = current.current[panel];
          move(
            panel,
            point.x + (direction[0] * 10) / Math.max(1, innerWidth - rect.width),
            point.y + (direction[1] * 10) / Math.max(1, innerHeight - rect.height),
          );
          void persist();
        }}
      >
        <GripHorizontal size={15} />
      </button>
    );
  }
  return (
    <main
      className={'player-overlay' + (editing ? ' is-editing' : '')}
      aria-label={t('Оверлей плеера')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && editing) void finish();
      }}
    >
      {(track || editing) && (
        <section
          data-overlay-panel="track"
          className="overlay-panel overlay-track"
          style={{
            left: 'calc(' + layout.track.x + ' * (100% - min(340px, 100vw)))',
            top: 'calc(' + layout.track.y + ' * (100% - 80px))',
          }}
        >
          {editing && handle('track')}
          <div className="overlay-track-content">
            <img
              src={
                track?.album?.cover_medium ||
                track?.album?.cover_small ||
                track?.album?.cover ||
                DEFAULT_COVER_SVG_DATA_URI
              }
              alt=""
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = DEFAULT_COVER_SVG_DATA_URI;
              }}
            />
            <div>
              <strong>{track?.title || 'SoSo Music'}</strong>
              <span>{track?.artist?.name || t('Ожидание трека...')}</span>
            </div>
          </div>
        </section>
      )}
      {editing && (
        <aside className="overlay-edit-toolbar" aria-label={t('Настройка положения')}>
          <div>
            <strong>{t('Настройка положения')}</strong>
            <span>{t('Перетащите карточку или используйте стрелки.')}</span>
          </div>
          <button className="overlay-done" onClick={() => void finish()}>
            <Check size={16} />
            {t('Готово')}
          </button>
        </aside>
      )}
      {editing && error && (
        <p className="overlay-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
