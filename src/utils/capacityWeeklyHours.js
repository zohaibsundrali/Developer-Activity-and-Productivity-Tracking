export function parseWeeklyHours(value) {
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
  if (!['string', 'number'].includes(typeof value)) throw new Error('Enter a number of hours, or leave blank to clear.');
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) throw new Error('Enter hours greater than 0 and up to 168, or leave blank to clear.');
  if (Math.abs(hours * 100 - Math.round(hours * 100)) > 1e-8) throw new Error('Use no more than two decimal places for contracted hours.');
  return hours;
}

export async function saveCapacityWeeklyHours({ fetcher, allowed, userId, userType, value }) {
  if (!allowed('employment.set_hours')) throw new Error('You do not have permission to change contracted hours.');
  if (!userId || !['admin', 'developer'].includes(userType)) throw new Error('A typed staff identity is required.');
  const weeklyHours = parseWeeklyHours(value);
  const response = await fetcher('/api/capacity', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, userType, weeklyHours }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.success) {
    if (response.status === 404) throw new Error('No employee profile was found. Create or verify this person’s employee profile before setting hours.');
    throw new Error(body?.error || 'Could not save contracted hours.');
  }
  const profile = body.profile;
  if (!profile?.id || profile.user_id !== userId || profile.user_type !== userType ||
      (weeklyHours === null ? profile.weekly_hours !== null : Number(profile.weekly_hours) !== weeklyHours)) {
    throw new Error('Could not confirm the hours update. Refresh the plan before retrying.');
  }
  return profile;
}
