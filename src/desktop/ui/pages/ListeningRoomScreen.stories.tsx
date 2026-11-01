import { ListeningRoomScreen } from './ListeningRoomScreen';
export default {
  title: 'Desktop/Listening room',
  component: ListeningRoomScreen,
  args: {
    session: { status: 'idle' },
    busy: false,
    error: null,
    onCreate: () => {},
    onJoin: () => {},
    onLeave: () => {},
    onBrowse: () => {},
  },
};
export const Landing = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const buttons = [...canvasElement.querySelectorAll('button')];
    const create = buttons.find((button) => button.textContent?.includes('Создать комнату'));
    if (!create) throw Error('Missing create-room action');
    create.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!canvasElement.querySelector('input[name="roomName"]'))
      throw Error('Create form did not open');
  },
};
export const Connected = {
  args: {
    session: {
      status: 'connected',
      role: 'host',
      name: 'Вечер с друзьями',
      selfId: 'one',
      invitation: 'SOSO1.…',
      latencyMs: 28,
      members: [
        { id: 'one', name: 'CatJAM', isHost: true },
        { id: 'two', name: 'Аня', isHost: false },
      ],
      playback: {
        track: {
          id: 'demo',
          title: 'Midnight City',
          artist: 'M83',
          album: '',
          duration: 240,
          source: 'youtube',
        },
        queue: [],
        playing: true,
        position: 32,
      },
    },
  },
};
