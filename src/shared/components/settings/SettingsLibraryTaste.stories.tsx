import { SettingsLibraryTaste } from './SettingsLibraryTaste';
import type { LibraryTasteReport } from '../../types/libraryTaste';

const report: LibraryTasteReport = {
  autoAnalyze: false,
  running: false,
  totalTracks: 120,
  processedTracks: 120,
  matchedTracks: 105,
  missingTracks: 15,
  failedTracks: 0,
  updatedAt: 1791763200000,
  genres: [
    { name: 'nu metal', tracks: 54, share: 0.6 },
    { name: 'grunge', tracks: 35, share: 0.35 },
  ],
};
export default {
  title: 'Settings/LibraryTaste',
  component: SettingsLibraryTaste,
  render: () => {
    let current = { ...report };
    window.electronAPI = Object.assign(window.electronAPI || {}, {
      getLibraryTaste: async () => current,
      analyzeLibraryTaste: async () => (current = { ...current, running: true }),
      cancelLibraryTaste: async () => (current = { ...current, running: false }),
      setLibraryTasteAutoAnalyze: async (autoAnalyze: boolean) =>
        (current = { ...current, autoAnalyze }),
    }) as typeof window.electronAPI;
    return (
      <div className="settings-modal" style={{ padding: 24, height: 'auto' }}>
        <SettingsLibraryTaste active />
      </div>
    );
  },
};
export const Profile = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    for (
      let attempt = 0;
      attempt < 100 && !canvasElement.querySelector('.library-genre-sector');
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    const toggle = canvasElement.querySelector<HTMLButtonElement>('[role="switch"]');
    if (!toggle || !canvasElement.textContent?.includes('63%'))
      throw new Error('Taste profile did not load');
    toggle.click();
    for (
      let attempt = 0;
      attempt < 100 && toggle.getAttribute('aria-checked') !== 'true';
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (toggle.getAttribute('aria-checked') !== 'true')
      throw new Error('Automatic analysis did not enable');
  },
};
