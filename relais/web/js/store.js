export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      for (const f of [...subs]) f(state, patch, prev);
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}
