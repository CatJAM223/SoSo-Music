import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_SHORTCUTS,
  DEFAULT_OVERLAY_LAYOUT,
  SHORTCUT_ACTIONS,
  normalizeShortcut,
  normalizeOverlayLayout,
  type ShortcutAction,
  type PlaybackShortcuts,
  type OverlayLayout,
  type DesktopControlsStatus,
} from '../../../shared/utils/desktopControls.ts';
type Registry = {
  register: (key: string, callback: () => void) => boolean;
  unregister: (key: string) => void;
};
export class DesktopControls {
  private filename: string;
  private registry: Registry;
  private dispatch: (action: ShortcutAction) => void;
  private keys = new Set<string>();
  private shortcuts: PlaybackShortcuts = { ...DEFAULT_SHORTCUTS };
  private layout: OverlayLayout = structuredClone(DEFAULT_OVERLAY_LAYOUT);
  private unavailable: ShortcutAction[] = [];
  private capturing = false;
  constructor(directory: string, registry: Registry, dispatch: (action: ShortcutAction) => void) {
    this.filename = path.join(directory, 'desktop-controls.json');
    this.registry = registry;
    this.dispatch = dispatch;
    try {
      const data = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      const shortcuts = {} as PlaybackShortcuts;
      for (const action of SHORTCUT_ACTIONS)
        shortcuts[action] = normalizeShortcut(data.shortcuts[action]);
      this.validateUnique(shortcuts);
      this.shortcuts = shortcuts;
      this.layout = normalizeOverlayLayout(data.layout);
    } catch {
      /* Missing or invalid local preferences use defaults. */
    }
  }
  private validateUnique(shortcuts: PlaybackShortcuts) {
    const keys = Object.values(shortcuts).filter(Boolean);
    if (new Set(keys).size !== keys.length) throw Error('DUPLICATE_SHORTCUT');
  }
  private release() {
    for (const key of this.keys) this.registry.unregister(key);
    this.keys.clear();
  }
  private register(shortcuts: PlaybackShortcuts) {
    this.release();
    this.unavailable = [];
    if (this.capturing) return;
    for (const action of SHORTCUT_ACTIONS) {
      const key = shortcuts[action];
      if (!key) continue;
      let registered = false;
      try {
        registered = this.registry.register(key, () => this.dispatch(action));
      } catch {}
      if (registered) this.keys.add(key);
      else this.unavailable.push(action);
    }
  }
  start() {
    this.register(this.shortcuts);
  }
  capture(enabled: boolean) {
    if (this.capturing === enabled) return this.status();
    this.capturing = enabled;
    this.register(this.shortcuts);
    return this.status();
  }
  status(): DesktopControlsStatus {
    return { shortcuts: { ...this.shortcuts }, unavailable: [...this.unavailable] };
  }
  getLayout() {
    return structuredClone(this.layout);
  }
  private persist(shortcuts: PlaybackShortcuts, layout: OverlayLayout) {
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    const tmp = this.filename + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ shortcuts, layout }) + '\n', { flag: 'wx' });
      fs.renameSync(tmp, this.filename);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  update(action: unknown, value: unknown) {
    if (!SHORTCUT_ACTIONS.includes(action as ShortcutAction))
      throw Error('INVALID_SHORTCUT_ACTION');
    const key = normalizeShortcut(value),
      next = { ...this.shortcuts, [action as string]: key };
    this.validateUnique(next);
    const suspended = this.capturing;
    this.capturing = false;
    try {
      this.register(next);
      if (key && this.unavailable.includes(action as ShortcutAction))
        throw Error('SHORTCUT_IN_USE');
      this.persist(next, this.layout);
      this.shortcuts = next;
      return this.status();
    } catch (error) {
      this.capturing = suspended;
      this.register(this.shortcuts);
      throw error;
    }
  }
  saveLayout(value: unknown) {
    const next = normalizeOverlayLayout(value);
    this.persist(this.shortcuts, next);
    this.layout = next;
    return this.getLayout();
  }
  dispose() {
    this.release();
  }
}
