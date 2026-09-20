import { requirePlatformOwner, platformJson } from '@/utils/platformOwner';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const access = await requirePlatformOwner(request);
    return access.error || platformJson({ platformOwner: true, email: access.user.email });
  } catch { return platformJson({ error: 'Platform access could not be checked.' }, 503); }
}
