import { platformRpc, platformJson, platformPage } from '@/utils/platformOwner';
import { platformFilters } from '@/utils/platformFilters';
export const dynamic = 'force-dynamic';
export function GET(request) {
  const search = new URL(request.url).searchParams;
  const page = platformPage(search), filters = platformFilters(search);
  if (!page || !filters || !['','all','active','suspended'].includes(filters.status)) return platformJson({ error: 'Invalid organization filters.' }, 400);
  return platformRpc(request, 'platform_organizations_filtered', { p_page: page, p_search: filters.search, p_status: filters.status, p_org: filters.organizationId || null, p_from: filters.from ? `${filters.from}T00:00:00.000Z` : null, p_to: filters.to ? new Date(Date.parse(filters.to) + 86400000).toISOString() : null });
}
