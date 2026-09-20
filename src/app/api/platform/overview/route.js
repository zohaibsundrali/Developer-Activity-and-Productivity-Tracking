import { platformRpc } from '@/utils/platformOwner';
export const dynamic = 'force-dynamic';
export const GET = request => platformRpc(request, 'platform_overview');
