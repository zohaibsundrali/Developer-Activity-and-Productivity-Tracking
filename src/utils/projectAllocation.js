/** Keep allocation writes separate from project role or membership changes. */
export async function saveProjectAllocation(fetcher, { projectId, userId, userType, value }) {
  if (value !== null && value !== undefined && !['number', 'string'].includes(typeof value)) throw new Error('Allocation must be a whole number from 0 to 100, or blank.');
  const text = String(value ?? '').trim();
  const allocationPct = text === '' ? null : Number(text);
  if (allocationPct !== null && (!/^\d+$/.test(text) || !Number.isInteger(allocationPct) || allocationPct > 100)) {
    throw new Error('Allocation must be a whole number from 0 to 100, or blank.');
  }
  if (!['admin', 'developer'].includes(userType)) throw new Error('The member identity could not be verified. Reload the team.');
  const response = await fetcher('/api/capacity', { method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, userId, userType, allocationPct }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) throw new Error(body.error || 'Could not save the allocation.');
  if (!body.member?.id || body.member.user_id !== userId || body.member.user_type !== userType ||
    body.member.project_id !== projectId || body.member.allocation_pct !== allocationPct) {
    throw new Error('Could not confirm the allocation. Reload the team before retrying.');
  }
  return body.member;
}
