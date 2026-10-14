import { AppUpdateNotice } from './AppUpdateNotice';
export default {
  title: 'Desktop/Update notification',
  component: AppUpdateNotice,
  render: () => (
    <AppUpdateNotice
      update={{ status: 'available', currentVersion: '3.1.0', latestVersion: '3.2.0', message: '' }}
      onDismiss={() => {}}
    />
  ),
};
export const NewVersion = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const dialog = canvasElement.ownerDocument.querySelector('[role="dialog"]');
    if (!dialog?.textContent?.includes('3.2.0') || !dialog.querySelector('.app-update-wave'))
      throw Error('Missing version or artwork');
  },
};
