import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Run a whole production hook with deterministic effects and clocks. Only its
// platform dependencies are replaced; callbacks and cleanup are never copied.
export function hookRuntime(url, bindings, globals = {}) {
  const slots = [],
    timers = new Map();
  let cursor = 0,
    serial = 0,
    dirty = true,
    mounted = true,
    lateUpdates = 0;
  let effects = [],
    api,
    props;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) {
        const slot = { value: typeof initial === 'function' ? initial() : initial };
        slot.set = (value) => {
          if (!mounted) {
            lateUpdates++;
            return;
          }
          const next = typeof value === 'function' ? value(slot.value) : value;
          if (!Object.is(next, slot.value)) {
            slot.value = next;
            dirty = true;
          }
        };
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
    useRef(value) {
      const i = cursor++;
      return (slots[i] ||= { current: value });
    },
    useMemo(callback, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: callback(), deps };
      return slots[i].value;
    },
    useCallback(callback, deps) {
      return react.useMemo(() => callback, deps);
    },
    useEffect(callback, deps) {
      const i = cursor++,
        old = slots[i];
      if (!same(old?.deps, deps))
        effects.push(() => {
          old?.cleanup?.();
          slots[i] = { deps, cleanup: callback() };
        });
    },
  };
  const exports = {};
  const context = vm.createContext({
    exports,
    module: { exports },
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
      if (name === 'react') return react;
      if (!Object.hasOwn(bindings, name)) throw new Error('Unstubbed import ' + name);
      if (bindings[name]?.source) {
        const dep = { exports: {} };
        const depContext = vm.createContext({
          ...context,
          module: dep,
          exports: dep.exports,
          require: context.require,
        });
        const depCode = ts.transpileModule(readFileSync(bindings[name].source, 'utf8'), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
        }).outputText;
        vm.runInContext(depCode, depContext);
        bindings[name] = dep.exports;
      }
      return bindings[name];
    },
  });
  const code = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInContext(code, context, { filename: url.pathname });
  const hookName = url.pathname
    .split('/')
    .at(-1)
    .replace(/\.tsx?$/, '');
  const hook = exports[hookName];
  if (typeof hook !== 'function') throw new Error('Missing named hook export ' + hookName);
  return {
    render(nextProps = props) {
      if (!mounted) throw new Error('Cannot render an unmounted hook fixture');
      props = nextProps;
      let passes = 0;
      do {
        if (++passes > 25) throw new Error('Hook did not settle');
        cursor = 0;
        dirty = false;
        effects = [];
        api = hook(props);
        effects.forEach((effect) => effect());
      } while (dirty);
      return api;
    },
    async flush() {
      await new Promise((resolve) => setImmediate(resolve));
      return this.render();
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      slots.forEach((slot) => slot?.cleanup?.());
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
  };
}
