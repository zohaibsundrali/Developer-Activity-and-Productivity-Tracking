// Bind report data to the requesting typed identity and exact date range.
export function reportIdentity(context) {
  return context?.organizationId && context?.userId && context?.userType
    ? JSON.stringify([context.organizationId, context.userType, context.userId, context.role])
    : null;
}

export function validateReportBundle(data, organizationId, range) {
  if (!data || data.orgId !== organizationId || data.range?.from !== range.from || data.range?.to !== range.to) {
    throw new Error('The report response did not match this organization and date range. Please retry.');
  }
  const fields = ['projects', 'tasks', 'employees', 'timeLogs', 'sessions'];
  if (!fields.every(key => Array.isArray(data[key]))
    || !data.truncated || typeof data.truncated !== 'object' || Array.isArray(data.truncated)
    || !fields.every(key => typeof data.truncated[key] === 'boolean')
    || Object.values(data.truncated).some(value => typeof value !== 'boolean')) {
    throw new Error('The report response was incomplete. Please retry.');
  }
  if (Object.values(data.truncated).some(Boolean)) {
    throw new Error('This report exceeds the reporting limit. Choose a shorter date range and retry.');
  }
  return data;
}

export function currentReportState(result, scope, authenticated) {
  if (!authenticated) return { bundle: null, loading: false, error: 'Sign in to load reports.' };
  if (result?.scope !== scope) return { bundle: null, loading: true, error: '' };
  return { bundle: result.bundle, loading: false, error: result.error };
}
