/** Fence preference loads/writes to one mounted, typed organization identity. */
export function createPreferenceRequests(getIdentity) {
  const identity = getIdentity();
  let active = true;
  let revision = 0;
  let lifecycle = 0;
  const pending = new Set();
  const current = () => active && getIdentity() === identity;
  return {
    canSave(category) { return current() && !pending.has(category); },
    activate() { active = true; },
    dispose() { active = false; revision += 1; lifecycle += 1; pending.clear(); },
    async load(read, apply) {
      if (!current() || pending.size) return;
      const ticket = ++revision;
      let result;
      try { result = await read(); } catch (error) { result = { error }; }
      if (current() && ticket === revision) apply(result);
    },
    async save(category, write, apply) {
      if (!current() || pending.has(category)) return false;
      revision += 1; // An older load must not undo an optimistic choice.
      pending.add(category);
      const epoch = lifecycle;
      let result;
      try { result = await write(); } catch (error) { result = { error }; }
      if (epoch === lifecycle) pending.delete(category);
      if (current() && epoch === lifecycle) apply(result);
      return true;
    },
  };
}
