import { SettingsShortcuts } from './SettingsShortcuts';
import { DEFAULT_SHORTCUTS } from '../../../../shared/utils/desktopControls';
export default {
  title: 'Settings/Keyboard shortcuts',
  component: SettingsShortcuts,
  render: () => {
    Object.assign(window.electronAPI || {}, {
      getDesktopControls: async () => ({ shortcuts: DEFAULT_SHORTCUTS, unavailable: [] }),
      captureDesktopShortcut: async () => ({ shortcuts: DEFAULT_SHORTCUTS, unavailable: [] }),
      setDesktopShortcut: async () => ({ shortcuts: DEFAULT_SHORTCUTS, unavailable: [] }),
      togglePlayerOverlay: async () => true,
    });
    return <SettingsShortcuts />;
  },
};
export const Defaults = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await new Promise((r) => setTimeout(r, 100));
    if (!canvasElement.textContent?.includes('Control+Shift+Space'))
      throw Error('Missing overlay shortcut');
  },
};
