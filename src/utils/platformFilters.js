import { isUuid } from '@/utils/workspaceIdentity';

export function platformFilters(search) {
  const organizationId = search.get('organizationId') || '';
  const from = search.get('from') || '';
  const to = search.get('to') || '';
  const status = search.get('status') || '';
  const query = (search.get('search') || search.get('q') || '').trim();
  const validDate = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if (organizationId && !isUuid(organizationId) || !validDate(from) || !validDate(to) || from && to && from > to || query.length > 100 || status.length > 50 || status && !/^[a-z_]+$/.test(status)) return null;
  return { organizationId, from, to, status, search: query };
}
export function applyPlatformFilters(builder, filters, { organizationColumn = 'organization_id', dateColumn = 'created_at', searchColumn, project = false } = {}) {
  if (filters.organizationId) builder = builder.eq(organizationColumn, filters.organizationId);
  if (filters.from) builder = builder.gte(dateColumn, `${filters.from}T00:00:00.000Z`);
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate()+1);
    builder = builder.lt(dateColumn, end.toISOString());
  }
  if (project && filters.status === 'archived') builder = builder.eq('archived', true);
  else if (project && filters.status === 'active') builder = builder.eq('archived', false);
  else if (filters.status && filters.status !== 'all') builder = builder.eq('status', filters.status);
  if (searchColumn && filters.search) builder = builder.ilike(searchColumn, `%${filters.search.replace(/[\\%_]/g, '\\$&')}%`);
  return builder;
}
