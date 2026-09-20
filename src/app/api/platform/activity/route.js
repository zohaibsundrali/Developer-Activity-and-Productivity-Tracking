import { platformRpc, platformJson, platformPage } from '@/utils/platformOwner';
export const dynamic = 'force-dynamic';
export function GET(request) {
  const page = platformPage(new URL(request.url).searchParams);
  return page ? platformRpc(request, 'platform_activity', { p_page: page }) : platformJson({ error: 'Invalid page.' }, 400);
}
