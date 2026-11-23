import { AppUpdateNotice } from './AppUpdateNotice';
export default {
  title: 'Desktop/Update notification',
  component: AppUpdateNotice,
  render: () => (
    <div className="app-update-anchor" style={{ marginTop: 320, minHeight: 90 }}>
      <AppUpdateNotice
        update={{
          status: 'available',
          currentVersion: '4.2.0',
          latestVersion: '4.3.0',
          message: '',
          releaseHighlights: {
            summary: 'Меньше повторов в рекомендациях.',
            changes: ['Дневная пятёрка помнит недавние показы.'],
          },
        }}
        onDismiss={() => {}}
      />
    </div>
  ),
};
export const NewVersion = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const notice = canvasElement.querySelector('.app-update-notice');
    const expand = notice?.querySelector<HTMLButtonElement>('.app-update-expand');
    if (!notice?.textContent?.includes('4.3.0') || !expand)
      throw Error('Missing version or details action');
    expand.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (expand.getAttribute('aria-expanded') !== 'true') throw Error('Details did not expand');
  },
};
