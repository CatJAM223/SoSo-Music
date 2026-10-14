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
      getOverlayEditing: async () => false,
      finishOverlayEditing: async () => false,
      onOverlayEditingChanged: () => () => {},
      togglePlayerOverlay: async () => false,
      onWidgetStateUpdate: () => () => {},
    });
    return <PlayerOverlay />;
  },
};
export const TrackInfo = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await new Promise((r) => setTimeout(r, 100));
    if (canvasElement.querySelectorAll('[data-overlay-panel]').length !== 1)
      throw Error('Expected a single track card');
    if (canvasElement.querySelector('button')) throw Error('Viewing overlay must have no controls');
  },
};
