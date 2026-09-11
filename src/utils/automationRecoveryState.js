export function automationIdentity(ctx) {
  return ctx?.organizationId && ctx?.userId && ['admin', 'developer'].includes(ctx.userType)
    ? `${ctx.organizationId}:${ctx.userType}:${ctx.userId}` : '';
}

// Each mounted history panel owns one generation. Never publish responses for a
// different signed-in profile, including an org switch during a retry request.
export function createAutomationRecovery({ getContext, fetchJobs, process, publish }) {
  const identity = automationIdentity(getContext());
  let active = true;
  let generation = 0;
  let retrying = false;
  let state = { jobs: [], loading: true, busy: false, error: '', loaded: false };
  const current = () => active && identity && automationIdentity(getContext()) === identity;
  const update = patch => {
    if (!active) return;
    if (!current()) {
      publish({ jobs: [], loading: false, busy: false, loaded: false, error: 'Your account changed. Reopen this page to load your deliveries.' });
      return;
    }
    state = { ...state, ...patch };
    publish(state);
  };
  async function load() {
    const request = ++generation;
    if (!current()) { update({}); return; }
    update({ loading: true, error: '', jobs: [], loaded: false });
    try {
      const { data, error } = await fetchJobs(getContext());
      if (request !== generation || !active) return;
      if (error) throw error;
      update({ jobs: data || [], loading: false, loaded: true });
    } catch {
      if (request === generation) update({ loading: false, loaded: false, error: 'Could not load automation delivery history. Please refresh history.' });
    }
  }
  async function retry() {
    if (retrying || !current()) { if (!current()) update({}); return; }
    retrying = true;
    update({ busy: true, error: '' });
    try {
      const result = await process({ retryFailed: true });
      if (!current()) { update({}); return; }
      await load();
      if (result.errors?.length) update({ error: result.errors.map(e => e.message).join(' ') });
    } catch {
      update({ error: 'Could not retry automation deliveries. Please try again.' });
    } finally {
      retrying = false;
      update({ busy: false });
    }
  }
  return { load, retry, dispose: () => { active = false; ++generation; } };
}
