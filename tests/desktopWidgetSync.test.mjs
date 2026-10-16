import test from 'node:test';
import assert from 'node:assert/strict';
import { hookRuntime } from './helpers/hookRuntime.mjs';

const ref = (current) => ({ current });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function fixture(initial = Promise.resolve(false)) {
  const sent = [],
    commands = [],
    intervals = new Map();
  let next = 0,
    visibility,
    remote;
  const props = {
    currentTrack: { id: 'one', title: 'One' },
    currentTrackRef: ref({ id: 'one', title: 'One' }),
    isPlaying: true,
    isPlayingRef: ref(true),
    duration: 180,
    likedTrackIds: new Set(),
    volume: 0.6,
    audioRef: ref({ currentTime: 12, duration: 180, volume: 0.6 }),
    togglePlay: () => commands.push('toggle'),
    nextTrack: () => commands.push('next'),
    prevTrack: () => commands.push('prev'),
    seek: (value) => commands.push(['seek', value]),
    setVolume: (value) => commands.push(['volume', value]),
    toggleLike: async (value) => {
      commands.push(['like', value.id]);
      return true;
    },
  };
  const api = {
    sendWidgetState: (value) => sent.push(value),
    isWidgetOpen: () => initial,
    onWidgetVisibilityChanged: (fn) => {
      visibility = fn;
      return () => {
        visibility = undefined;
      };
    },
    onWidgetCommand: (fn) => {
      remote = fn;
      return () => {
        remote = undefined;
      };
    },
  };
  const h = hookRuntime(
    new URL('../src/shared/hooks/useDesktopWidgetSync.ts', import.meta.url),
    {},
    {
      window: { electronAPI: api },
      setInterval(fn, ms) {
        const id = ++next;
        intervals.set(id, { fn, ms });
        return id;
      },
      clearInterval: (id) => intervals.delete(id),
    },
  );
  h.render(props);
  return {
    h,
    props,
    sent,
    commands,
    intervals,
    visibility: () => visibility,
    remote: () => remote,
    tick: () => [...intervals.values()].forEach((timer) => timer.fn()),
  };
}

test('Closed widget allocates no progress timer but track changes still reach the overlay', async () => {
  const f = fixture();
  await f.h.flush();
  assert.equal(f.intervals.size, 0);
  assert.equal(f.sent.length, 1);
  f.props.currentTrack = { id: 'two', title: 'Two' };
  f.props.currentTrackRef.current = f.props.currentTrack;
  f.h.render(f.props);
  assert.equal(f.sent.at(-1).track.id, 'two');
  assert.equal(f.intervals.size, 0);
  f.h.unmount();
  assert.equal(f.visibility(), undefined);
  assert.equal(f.remote(), undefined);
});
test('Only a playing open widget receives periodic progress correction; closing releases the timer', async () => {
  const f = fixture();
  await f.h.flush();
  f.visibility()(true);
  f.h.render();
  assert.equal(f.intervals.size, 1);
  assert.equal([...f.intervals.values()][0].ms, 5000);
  f.props.audioRef.current.currentTime = 27;
  f.tick();
  assert.equal(f.sent.at(-1).currentTime, 27);
  f.props.isPlaying = false;
  f.props.isPlayingRef.current = false;
  f.h.render();
  assert.equal(f.intervals.size, 0);
  f.props.isPlaying = true;
  f.props.isPlayingRef.current = true;
  f.h.render();
  assert.equal(f.intervals.size, 1);
  f.visibility()(false);
  f.h.render();
  assert.equal(f.intervals.size, 0);
  const count = f.sent.length;
  f.tick();
  assert.equal(f.sent.length, count);
  f.h.unmount();
});
test('Initial widget handshake cannot override a newer open/close event', async () => {
  for (const initial of [false, true]) {
    const pending = deferred(),
      f = fixture(pending.promise);
    f.visibility()(!initial);
    f.h.render();
    pending.resolve(initial);
    await f.h.flush();
    assert.equal(f.intervals.size, initial ? 0 : 1);
    f.h.unmount();
    assert.equal(f.intervals.size, 0);
  }
});
test('Late widget handshake after unmount is inert and existing remote controls still work', async () => {
  const pending = deferred(),
    f = fixture(pending.promise);
  for (const command of ['togglePlay', 'next', 'prev', 'toggleLike', 'requestState'])
    f.remote()(command);
  f.remote()('seek', 45);
  f.remote()('setVolume', 0.3);
  assert.deepEqual(f.commands, [
    'toggle',
    'next',
    'prev',
    ['like', 'one'],
    ['seek', 45],
    ['volume', 0.3],
  ]);
  assert.equal(f.sent.at(-1).currentTime, 12);
  f.h.unmount();
  pending.resolve(true);
  await new Promise((r) => setImmediate(r));
  assert.equal(f.h.lateUpdates(), 0);
  assert.equal(f.intervals.size, 0);
});
