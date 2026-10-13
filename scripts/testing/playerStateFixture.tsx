import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useQueueManager } from './src/shared/hooks/useQueueManager';
import { useLibraryCaches } from './src/shared/hooks/useLibraryCaches';
import { useMyMusicViewModel } from './src/shared/hooks/useMyMusicViewModel';

const w = window as any;
w.offlineListeners = new Set();
w.offlineReads = 0;
const root = createRoot(document.getElementById('root')!);
function Fixture({ consumer = 0 }) {
  const queue = useQueueManager(),
    library = useLibraryCaches();
  w.states[consumer] = { queue, library };
  return (
    <button id={'command-' + consumer} onClick={() => w.command(queue, library)}>
      Command
    </button>
  );
}
function ViewFixture() {
  w.view = useMyMusicViewModel({ initialTab: 'history' });
  return <div>{w.view.historyItems.length}</div>;
}
const song = (id: string) => ({
  id,
  title: id,
  artist: { name: 'Artist' },
  album: { title: 'Album' },
  duration: 100,
});
const ensure = (condition: boolean, message: string) => {
  if (!condition) throw Error(message);
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function mount() {
  w.states = [];
  flushSync(() =>
    root.render(
      <React.StrictMode>
        <Fixture />
        <Fixture consumer={1} />
      </React.StrictMode>,
    ),
  );
}
function command(callback: Function) {
  w.command = callback;
  flushSync(() => document.getElementById('command-0')!.click());
}
w.verifyPlayerState = async () => {
  mount();
  await tick();
  ensure(w.offlineListeners.size === 1, 'Consumers duplicated the offline-change subscription');
  const before = w.offlineReads;
  w.offlineListeners.forEach((listener: Function) => listener());
  await tick();
  ensure(w.offlineReads === before + 1, 'One offline mutation issued duplicate reads');
  command((api: any) => {
    api.setQueue(['a', 'b', 'c', 'd'].map(song));
    api.setQueueIndex(2);
  });
  command((api: any) => {
    api.insertIntoQueue(song('new'), 0);
    api.removeFromQueue(1);
    api.removeFromQueue(1);
  });
  let api = w.states[0].queue;
  ensure(
    api.queue[api.queueIndex].id === 'c' && api.queue[api.queueIndex + 1].id === 'd',
    'Batched queue commands shifted the playing item',
  );
  command((api: any) => {
    api.cycleRepeatMode();
    api.cycleRepeatMode();
  });
  ensure(w.states[0].queue.repeatMode === 'one', 'Repeat commands read stale state');
  command((api: any) => api.removeFromQueue(0));
  api = w.states[0].queue;
  ensure(api.queueIndex === 0 && api.queue[0].id === 'c', 'StrictMode replayed cursor decrement');
  command((api: any) => api.setIsShuffle(true));
  await tick();
  ensure(
    w.states[0].queue.shuffledUpcomingIndices.length === 1,
    'Shuffle did not expose upcoming order',
  );
  for (let i = 0; i < 200; i++) {
    command((api: any) => {
      api.setQueue(['a', 'b', 'c', 'd'].map(song));
      api.setQueueIndex(2);
      api.insertIntoQueue(song('inserted'), 0);
      api.removeFromQueue(1);
      api.reorderQueue(0, 3);
    });
    api = w.states[0].queue;
    ensure(api.queue[api.queueIndex].id === 'c', 'Stress pass moved the current item: ' + i);
    ensure(
      api.queueRef.current === api.queue && api.queueIndexRef.current === api.queueIndex,
      'State and command refs diverged',
    );
  }
  command((_queue: any, library: any) => library.setSavedAlbumIds(new Set(['album'])));
  ensure(
    w.states.every((state: any) => state.library.savedAlbumIds.has('album')),
    'Library consumers missed a committed update',
  );
  for (let i = 0; i < 30; i++) {
    flushSync(() => root.render(null));
    ensure(w.offlineListeners.size === 0, 'Unmount leaked an offline subscription');
    mount();
    await tick();
    ensure(w.offlineListeners.size === 1, 'Remount duplicated subscriptions');
    ensure(
      w.states.every((state: any) => state.library.savedAlbumIds.has('album')),
      'Remount used a stale library snapshot',
    );
  }
  let releaseHistory: Function;
  const oldHistory = new Promise((resolve) => {
    releaseHistory = resolve;
  });
  w.historyRead = () => oldHistory;
  flushSync(() =>
    root.render(
      <React.StrictMode>
        <ViewFixture />
      </React.StrictMode>,
    ),
  );
  await tick();
  await w.view.confirmClearHistory();
  await tick();
  releaseHistory!([{ id: 1, title: 'Deleted history', artist: 'Artist' }]);
  await tick();
  ensure(
    w.view.historyItems.length === 0 && !w.view.loadingHistory,
    'An old history read restored a cleared list',
  );
  flushSync(() => root.unmount());
  ensure(w.offlineListeners.size === 0, 'Final unmount leaked subscriptions');
  return {
    strictMode: true,
    queueStressPasses: 200,
    remountPasses: 30,
    sharedOfflineReads: true,
    clearedHistoryNotRestored: true,
    subscriptionsAfterUnmount: 0,
  };
};
