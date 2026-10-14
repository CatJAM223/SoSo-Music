import { PlayerOverlay } from './PlayerOverlay';
import { DEFAULT_OVERLAY_LAYOUT } from '../../../shared/utils/desktopControls';
export default {
  title: 'Desktop/Player overlay',
  component: PlayerOverlay,
  render: () => {
    Object.assign(window.electronAPI || {}, {
      getOverlayLayout: async () => DEFAULT_OVERLAY_LAYOUT,
      getOverlayState: async () => ({
        track: {
          id: 'demo',
          title: 'Current song',
          artist: { name: 'Artist' },
          album: {},
          duration: 200,
        },
        isPlaying: true,
        currentTime: 0,
        duration: 200,
        isLiked: false,
        volume: 1,
      }),
      saveOverlayLayout: async (value: unknown) => value,
      setOverlayInteractive: async () => {},
      togglePlayerOverlay: async () => false,
      onWidgetStateUpdate: () => () => {},
    });
    return <PlayerOverlay />;
  },
};
export const Panels = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await new Promise((r) => setTimeout(r, 100));
    if (canvasElement.querySelectorAll('[data-overlay-panel]').length !== 2)
      throw Error('Expected independent track and controls panels');
  },
};
