import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the production engine directly. No React lifecycle or playback logic is simulated.
export function playbackEngineRuntime(url, bindings, globals = {}) {
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
    fireTimers(delay) {
      for (const [id, timer] of [...timers])
        if (timer.delay === delay) {
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
