/** Latest selected week wins, including retries and responses after unmount. */
export function createCapacityPlanRequest(fetcher, publish) {
  let generation = 0;
  let controller;
  const cancel = () => { generation += 1; controller?.abort(); };
  return {
    cancel,
    async load(week, scope) {
      cancel();
      const ticket = generation;
      controller = new AbortController();
      publish({ scope, loading: true, rows: [], error: '' });
      try {
        const response = await fetcher(`/api/capacity?week=${encodeURIComponent(week)}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body?.success) throw new Error(body?.error || 'Could not load the plan.');
        if (ticket === generation) publish({ scope, loading: false, rows: body.rows || [], error: '' });
      } catch (error) {
        if (ticket === generation) publish({ scope, loading: false, rows: [], error: error?.message || 'Could not load the plan.' });
      }
    },
  };
}
