import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the production engine directly. No React lifecycle or playback logic is simulated.
export function playbackEngineRuntime(url, bindings, globals = {}) {
  bindings['./preparedAudio.ts'] ??= {
    source: new URL('../../src/shared/services/preparedAudio.ts', import.meta.url),
  };
  bindings['../utils/playbackStartupBudget'] ??= {
    source: new URL('../../src/shared/utils/playbackStartupBudget.ts', import.meta.url),
  };
  if (!Object.hasOwn(bindings, '../utils/streamResolveDeadline.ts')) {
    bindings['../utils/streamResolveDeadline.ts'] = {
      source: new URL('../../src/shared/utils/streamResolveDeadline.ts', import.meta.url),
    };
  }

  const timers = new Map();
  let serial = 0,
    engine,
    props,
    api,
    lateUpdates = 0;
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    Date,
    Math,
    Number,
    URL,
    Event,
    CustomEvent,
    AbortController,
    performance,
    setTimeout(callback, delay) {
      const id = ++serial;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    ...globals,
    require(name) {
      const aliases = {
        './playerStreamResolution.ts': '../services/playerStreamResolution',
        './audioCacheService.ts': '../services/audioCacheService',
        './createPlayerAudio.ts': '../services/createPlayerAudio',
        '../bridge/platformBridge.ts': '../bridge/platformBridge',
        '../utils/audioUrlValidator.ts': '../utils/audioUrlValidator',
      };
      if (!Object.hasOwn(bindings, name) && aliases[name]) name = aliases[name];
      if (name === '../utils/playbackStartupBudget.ts' || name === './playbackStartupBudget.ts')
        name = '../utils/playbackStartupBudget';
      if (!Object.hasOwn(bindings, name)) throw new Error('Unstubbed import ' + name);
      if (bindings[name]?.source) bindings[name] = evaluate(bindings[name].source);
      return bindings[name];
    },
  });
  function evaluate(source) {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(source, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInContext('(function(exports,module){' + code + '\n})', context, {
      filename: source.pathname,
    })(module.exports, module);
    return module.exports;
  }
  const { PlaybackEngine } = evaluate(url);
  return {
    render(nextProps = props) {
      props = nextProps;
      if (!engine) {
        engine = new PlaybackEngine(props);
        const changed = engine.stateChanged.bind(engine);
        engine.stateChanged = (key) => {
          if (!engine.isMounted) lateUpdates++;
          changed(key);
        };
        engine.mount();
      } else engine.setDependencies(props);
      api = { ...engine.getControls(), ...engine.getSnapshot() };
      return api;
    },
    async flush() {
      await new Promise((resolve) => setImmediate(resolve));
      return this.render();
    },
    unmount() {
      engine?.dispose();
    },
    remount() {
      engine.mount();
      return this.render();
    },
    fireTimers(delay, tolerance = 0) {
      for (const [id, timer] of [...timers])
        if (timer.delay <= delay && timer.delay >= delay - tolerance) {
          timers.delete(id);
          timer.callback();
        }
    },
    timers: () => timers.size,
    lateUpdates: () => lateUpdates,
    api: () => api,
    engine: () => engine,
  };
}
