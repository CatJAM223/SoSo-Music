import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cardColumns, cardRowHeight, cardWindow } from '../../../shared/utils/virtualCardGrid';
type Props<T> = {
  items: T[];
  kind: 'playlists' | 'albums' | 'artists';
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  leading?: ReactNode;
  label: string;
};
export function VirtualCardGrid<T>({ items, kind, itemKey, renderItem, leading, label }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({
    width: 0,
    viewportWidth: 1024,
    scroll: 0,
    viewport: 800,
  });
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const main = element.closest('main');
    const host: HTMLElement | Window = main || window;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        const hostTop = main?.getBoundingClientRect().top || 0;
        setGeometry({
          width: rect.width,
          viewportWidth: window.innerWidth,
          scroll: Math.max(0, hostTop - rect.top),
          viewport: main?.clientHeight || window.innerHeight,
        });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (main) observer.observe(main);
    host.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      host.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);
  const columns = cardColumns(geometry.viewportWidth, kind),
    height = cardRowHeight(geometry.width, columns, geometry.viewportWidth, kind);
  const count = items.length + (leading ? 1 : 0);
  const range = cardWindow(count, columns, height, geometry.scroll, geometry.viewport);
  const keyAt = (index: number) =>
    leading && index === 0
      ? 'leading:create-playlist'
      : 'entity:' + itemKey(items[index - (leading ? 1 : 0)]);
  const itemAt = (index: number) =>
    leading && index === 0 ? leading : renderItem(items[index - (leading ? 1 : 0)]);
  const entityIndex =
    focusedKey === null ? -1 : items.findIndex((item) => 'entity:' + itemKey(item) === focusedKey);
  const focusedIndex =
    focusedKey === 'leading:create-playlist' && leading
      ? 0
      : entityIndex < 0
        ? -1
        : entityIndex + (leading ? 1 : 0);
  const focusedRow = focusedIndex < 0 ? -1 : Math.floor(focusedIndex / columns);
  const row = (rowIndex: number, pinned = false) => (
    <div
      key={rowIndex}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(' + columns + ',minmax(0,1fr))',
        gap: 16,
        height,
        marginBottom: rowIndex < Math.ceil(count / columns) - 1 ? 16 : 0,
        ...(pinned
          ? { position: 'absolute' as const, top: rowIndex * range.stride, left: 0, right: 0 }
          : {}),
      }}
    >
      {Array.from(
        { length: Math.min(columns, count - rowIndex * columns) },
        (_, column) => rowIndex * columns + column,
      ).map((index) => (
        <div
          key={keyAt(index)}
          data-card-key={keyAt(index)}
          style={{ height, minWidth: 0 }}
          className="[&>*]:h-full"
        >
          {itemAt(index)}
        </div>
      ))}
    </div>
  );
  return (
    <div
      ref={ref}
      aria-label={label}
      style={{ position: 'relative' }}
      onFocusCapture={(event) =>
        setFocusedKey(
          (event.target as HTMLElement).closest<HTMLElement>('[data-card-key]')?.dataset.cardKey ||
            null,
        )
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedKey(null);
      }}
    >
      <div aria-hidden="true" style={{ height: range.top }} />
      {Array.from(
        new Set([
          ...Array.from({ length: range.last - range.first }, (_, index) => range.first + index),
          ...(focusedRow >= 0 ? [focusedRow] : []),
        ]),
      )
        .sort((a, b) => a - b)
        .map((index) => row(index, index < range.first || index >= range.last))}
      <div
        aria-hidden="true"
        style={{ height: Math.max(0, range.height - range.last * range.stride) }}
      />
    </div>
  );
}
