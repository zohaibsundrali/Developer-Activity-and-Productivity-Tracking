import { platformAccessIdentity, platformJson } from '@/utils/platformOwner';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const access = await platformAccessIdentity(request);
    if (access.error) return access.error;
    const data = { platformOwner: access.platformRole === 'owner', platformAccess: true, email: access.user.email, ...access.capabilities };
    if (data.mfaRequired && !data.mfaSatisfied) return platformJson({ ...data, code: 'MFA_REQUIRED', error: 'Verify your authenticator to continue.' }, 403);
    return platformJson(data);
  } catch { return platformJson({ error: 'Platform access could not be checked.' }, 503); }
}
