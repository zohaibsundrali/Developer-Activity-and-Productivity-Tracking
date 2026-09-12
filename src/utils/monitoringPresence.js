const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

export function validateMonitoringPresence(data, organizationId, profileId) {
  if (!UUID.test(organizationId || '') || !UUID.test(profileId || '') || !data
    || data.organization_id !== organizationId || data.developer_id !== profileId
    || !instant(data.server_now) || data.freshness_seconds !== 90
    || !Array.isArray(data.devices) || data.devices.length > 100
    || !Number.isSafeInteger(data.total) || data.total < data.devices.length
    || data.truncated !== (data.total > data.devices.length)) throw new Error('Invalid presence response');
  const ids = new Set();
  for (const row of data.devices) {
    if (!row || !UUID.test(row.id || '') || ids.has(row.id)
      || typeof row.name !== 'string' || typeof row.platform !== 'string'
      || ![null, 'tracking', 'paused', 'idle'].includes(row.state)
      || !instant(row.expires_at) || (row.revoked_at !== null && !instant(row.revoked_at))
      || (row.last_seen_at !== null && !instant(row.last_seen_at))
      || (row.state === null) !== (row.last_seen_at === null)
      || (row.last_seen_at !== null && Date.parse(row.last_seen_at) > Date.parse(data.server_now))) throw new Error('Invalid device presence');
    ids.add(row.id);
  }
  return data;
}

/** Server time plus elapsed monotonic time avoids relying on the viewer's clock. */
export function monitoringPresenceView(receipt, elapsedMs = 0) {
  if (!receipt || !Number.isFinite(elapsedMs) || elapsedMs < 0) return { status: 'unknown', devices: [] };
  const now = Date.parse(receipt.server_now) + elapsedMs;
  const devices = receipt.devices.map(row => {
    let status = row.state;
    if (row.revoked_at !== null) status = 'revoked';
    else if (Date.parse(row.expires_at) <= now) status = 'expired';
    else if (row.last_seen_at === null) status = 'unavailable';
    else if (now - Date.parse(row.last_seen_at) >= receipt.freshness_seconds * 1000) status = 'disconnected';
    return { ...row, status };
  });
  const status = ['tracking', 'paused', 'idle'].find(state => devices.some(row => row.status === state))
    || (receipt.truncated ? 'unknown' : devices.some(row => row.status === 'disconnected') ? 'disconnected' : 'unavailable');
  return { status, devices, total: receipt.total, truncated: receipt.truncated };
}

export function createMonitoringPresenceController({ client, organizationId, profileId, guard, onChange, now = () => performance.now(), timeoutMs = 15000 }) {
  let disposed = false, running = false, receipt = null, anchor = 0, generation = 0, pendingAbort = null;
  const current = () => !disposed && guard.current();
  const publish = state => { if (current()) onChange(state); };
  const tick = () => { if (receipt) publish({ ...monitoringPresenceView(receipt, now() - anchor), loading: false, error: '' }); };
  return {
    tick,
    invalidate() {
      generation += 1; pendingAbort?.abort(); pendingAbort = null;
      running = false; receipt = null;
      publish({ status: 'unknown', devices: [], loading: true, error: '' });
    },
    async refresh() {
      if (!current() || running) return;
      running = true;
      const started = now();
      const abort = new AbortController();
      pendingAbort = abort;
      const ticket = ++generation;
      let timeout;
      try {
        const request = client.rpc('monitoring_tracker_presence', { p_organization_id: organizationId, p_developer_id: profileId });
        const result = await Promise.race([
          typeof request.abortSignal === 'function' ? request.abortSignal(abort.signal) : request,
          new Promise((_, reject) => { timeout = setTimeout(() => { abort.abort(); reject(new Error('Presence request timed out')); }, timeoutMs); }),
        ]);
        if (!current() || ticket !== generation) return;
        if (result.error) throw result.error;
        receipt = validateMonitoringPresence(result.data, organizationId, profileId);
        // Anchor at request start, conservatively including network latency.
        anchor = started;
        tick();
      } catch {
        if (!current() || ticket !== generation) return;
        receipt = null;
        publish({ status: 'unknown', devices: [], loading: false, error: 'Live status unavailable. Retry or check your monitoring access.' });
      } finally { clearTimeout(timeout); if (ticket === generation) { running = false; pendingAbort = null; } }
    },
    dispose() { disposed = true; generation += 1; pendingAbort?.abort(); receipt = null; guard.dispose?.(); },
  };
}
