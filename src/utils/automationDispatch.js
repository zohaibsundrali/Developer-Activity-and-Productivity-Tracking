import { authFetch } from '@/utils/authFetch';
import { getOrgContext } from '@/utils/orgContext';
const sessions = new Map();
export async function processPendingAutomations({ retryFailed = false, force = false } = {}) {
  const ctx = getOrgContext();
  if (!ctx?.organizationId || !ctx?.userId || !['admin', 'developer'].includes(ctx?.userType)) return { ran: 0, errors: [], pending: 0 };
  const key = `${ctx.organizationId}:${ctx.userType}:${ctx.userId}`;
  const current = sessions.get(key);
  if (current?.promise) return current.promise;
  if (!force && !retryFailed && current && Date.now() - current.at < 15000) return current.result || { ran: 0, errors: [], pending: 0 };
  const entry = { at: Date.now(), promise: null, result: null };
  entry.promise = (async () => {
    try {
      const response = await authFetch('/api/automation/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retryFailed }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Automation processing unavailable.');
      return data;
    } catch (error) {
      return { ran: 0, pending: 0, errors: [{ action: 'engine', message: error?.message || 'Automation processing unavailable; queued work will retry.' }] };
    }
  })();
  sessions.set(key, entry);
  entry.result = await entry.promise;
  entry.promise = null;
  return entry.result;
}
