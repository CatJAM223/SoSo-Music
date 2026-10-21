export const SHORTCUT_ACTIONS = ['overlay', 'next', 'prev', 'togglePlay'] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type PlaybackShortcuts = Record<ShortcutAction, string>;
export type OverlayLayout = Record<'track' | 'controls', { x: number; y: number }>;

/** Normal viewing needs only the card surface; the display-sized surface is reserved for editing. */
export function overlayWindowBounds(
  display: { x: number; y: number; width: number; height: number },
  layout: OverlayLayout,
  editing: boolean,
) {
  if (editing) return { ...display };
  const width = Math.min(340, display.width);
  const height = Math.min(80, display.height);
  return {
    x: display.x + Math.round((display.width - width) * layout.track.x),
    y: display.y + Math.round((display.height - height) * layout.track.y),
    width,
    height,
  };
}
export type DesktopControlsStatus = {
  shortcuts: PlaybackShortcuts;
  unavailable: ShortcutAction[];
  overlayEnabled: boolean;
};
export const DEFAULT_SHORTCUTS: PlaybackShortcuts = {
  overlay: 'Control+Shift+Space',
  next: 'Control+Alt+Right',
  prev: 'Control+Alt+Left',
  togglePlay: 'Control+Alt+Space',
};
export const DEFAULT_OVERLAY_LAYOUT: OverlayLayout = {
  track: { x: 0.04, y: 0.75 },
  controls: { x: 0.04, y: 0.9 },
};
export function normalizeShortcut(value: unknown): string {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 100) throw Error('INVALID_SHORTCUT');
  const parts = value.split('+'),
    key = parts.pop()!;
  const modifiers = ['Control', 'Alt', 'Shift', 'Super'].filter((m) => parts.includes(m));
  if (
    parts.length !== modifiers.length ||
    !/^([A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Left|Right|Up|Down|Home|End|PageUp|PageDown|Tab|Enter|Backspace|Delete|Insert|Capslock|Numlock|Scrolllock|PrintScreen|Plus|num[0-9]|numdec|numadd|numsub|nummult|numdiv|[;,./\\\[\]\x60=\-])$/.test(
      key,
    )
  )
    throw Error('INVALID_SHORTCUT');
  return [...modifiers, key].join('+');
}
export function shortcutFromKey(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
): string | null {
  const aliases: Record<string, string> = {
    Equal: '=',
    Minus: '-',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: String.fromCharCode(92),
    Semicolon: ';',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: String.fromCharCode(96),
    NumpadDecimal: 'numdec',
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    NumpadEnter: 'Enter',
    CapsLock: 'Capslock',
    NumLock: 'Numlock',
    ScrollLock: 'Scrolllock',
  };
  const key =
    aliases[event.code] ||
    event.code
      .replace(/^Key|^Digit/, '')
      .replace(/^Arrow/, '')
      .replace(/^Numpad(?=[0-9]$)/, 'num');
  try {
    return normalizeShortcut(
      [
        event.ctrlKey && 'Control',
        event.altKey && 'Alt',
        event.shiftKey && 'Shift',
        event.metaKey && 'Super',
        key,
      ]
        .filter(Boolean)
        .join('+'),
    );
  } catch {
    return null;
  }
}
export function normalizeOverlayLayout(value: unknown): OverlayLayout {
  if (!value || typeof value !== 'object') throw Error('INVALID_OVERLAY_LAYOUT');
  const result = {} as OverlayLayout;
  for (const name of ['track', 'controls'] as const) {
    const point = (value as OverlayLayout)[name];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw Error('INVALID_OVERLAY_LAYOUT');
    result[name] = { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) };
  }
  return result;
}
