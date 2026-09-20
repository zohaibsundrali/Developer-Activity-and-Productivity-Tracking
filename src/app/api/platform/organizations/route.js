import { platformRpc, platformJson, platformPage } from '@/utils/platformOwner';
export const dynamic = 'force-dynamic';
export function GET(request) {
  const search = new URL(request.url).searchParams;
  const page = platformPage(search);
  if (!page) return platformJson({ error: 'Invalid page.' }, 400);
  return platformRpc(request, 'platform_organizations', { p_page: page, p_search: (search.get('q') || '').slice(0,100) });
}
