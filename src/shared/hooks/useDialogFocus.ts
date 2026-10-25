import { useEffect, useRef, type RefObject } from 'react';

/** Contain keyboard focus and restore it without triggering shortcuts in the player below. */
export function useDialogFocus(panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ) || [],
      );
    (panel.current?.querySelector<HTMLElement>('[data-initial-focus]') || focusables()[0])?.focus();
    const handleKey = (event: KeyboardEvent) => {
      const focusedDialog = document.activeElement?.closest('[role="dialog"]');
      if (focusedDialog && focusedDialog !== panel.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') {
        event.stopImmediatePropagation();
        return;
      }
      const items = focusables(),
        first = items[0],
        last = items[items.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || !panel.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !panel.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [panel]);
}
