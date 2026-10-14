import { SettingsShortcuts } from './SettingsShortcuts';
import { DEFAULT_SHORTCUTS } from '../../../../shared/utils/desktopControls';
export default {
  title: 'Settings/Keyboard shortcuts',
  component: SettingsShortcuts,
  render: () => {
    Object.assign(window.electronAPI || {}, {
      getDesktopControls: async () => ({
        shortcuts: DEFAULT_SHORTCUTS,
        unavailable: [],
        overlayEnabled: true,
      }),
      captureDesktopShortcut: async () => ({ shortcuts: DEFAULT_SHORTCUTS, unavailable: [] }),
      setDesktopShortcut: async () => ({ shortcuts: DEFAULT_SHORTCUTS, unavailable: [] }),
      togglePlayerOverlay: async () => true,
      editPlayerOverlay: async () => true,
    });
    return <SettingsShortcuts />;
  },
};
export const Defaults = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await new Promise((r) => setTimeout(r, 100));
    if (
      canvasElement.querySelector('[data-shortcut-action=overlay]')?.querySelectorAll('kbd')
        .length !== 3
    )
      throw Error('Missing overlay shortcut');
  },
};
