import { platformJson, platformPage, requirePlatformPermission } from '@/utils/platformOwner';
import { platformFilters } from '@/utils/platformFilters';
import { isUuid } from '@/utils/workspaceIdentity';
import { sendTemplatedEmail } from '@/utils/emailService';
export const dynamic = 'force-dynamic';
const permissions = { 'organization.status': 'organizations.manage', 'member.invite': 'members.manage', 'member.role': 'members.manage', 'member.status': 'members.manage', 'member.sessions': 'members.manage', 'team.upsert': 'team.manage', 'team.remove': 'team.manage', 'team.mfa': 'team.manage' };
function failure(error) {
  const known = ['22023', '23514', '23505', '23503', '42501'].includes(error?.code);
  return platformJson({ error: known ? error.message : 'The operation could not be completed. Check organization billing and retry.' }, error?.code === '42501' ? 403 : known ? 409 : 503);
}
export async function GET(request) {
  try {
    const search = new URL(request.url).searchParams, kind = search.get('kind') || 'members', org = search.get('organizationId'), page = platformPage(search), filters = platformFilters(search);
    if (!['members', 'team', 'organization'].includes(kind) || !page || !filters || (org && !isUuid(org))) return platformJson({ error: 'Invalid list request.' }, 400);
    const access = await requirePlatformPermission(request, kind === 'team' ? 'team.manage' : kind === 'members' ? 'members.manage' : 'organizations.read');
    if (access.error) return access.error;
    const result = await access.svc.rpc('platform_management_list', { ...access.args, p_kind: kind, p_org: org || null, p_search: (search.get('search') || '').slice(0,100), p_page: page, p_status: filters.status, p_from: filters.from ? `${filters.from}T00:00:00.000Z` : null, p_to: filters.to ? new Date(Date.parse(filters.to) + 86400000).toISOString() : null });
    return result.error ? failure(result.error) : platformJson(result.data);
  } catch { return platformJson({ error: 'Management records unavailable.' }, 503); }
}
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null), permission = permissions[body?.action];
    if (!permission || typeof body.reason !== 'string' || body.reason.trim().length < 8 || body.reason.length > 500) return platformJson({ error: 'Choose a valid action and provide a reason of 8–500 characters.' }, 400);
    for (const key of ['organizationId', 'membershipId', 'authUserId']) if (body[key] != null && !isUuid(body[key])) return platformJson({ error: `Invalid ${key}.` }, 400);
    const access = await requirePlatformPermission(request, permission);
    if (access.error) return access.error;
    if (body.action === 'team.mfa' && body.mfaRequired === true && !access.capabilities.mfaSatisfied) return platformJson({ error: 'Verify your authenticator before requiring MFA.', code: 'MFA_REQUIRED' }, 403);
    let origin;
    if (body.action === 'member.invite') {
      try { origin = new URL(process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV !== 'production' ? request.url : '')).origin; } catch { return platformJson({ error: 'Invitation links are not configured.' }, 503); }
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) return platformJson({ error: 'Invitation links require HTTPS.' }, 503);
    }
    const data = Object.fromEntries(['organizationId','membershipId','authUserId','email','role','status','mfaRequired'].filter(k => body[k] !== undefined).map(k => [k,body[k]]));
    const result = await access.svc.rpc('platform_management_mutate', { ...access.args, p_action: body.action, p_data: data, p_reason: body.reason.trim() });
    if (result.error) return failure(result.error);
    if (body.action !== 'member.invite') return platformJson(result.data);
    const inviteLink = `${origin}/invite/${result.data.token}`;
    let emailed = false;
    try {
      const org = await access.svc.from('organizations').select('name').eq('id', body.organizationId).maybeSingle();
      const sent = await sendTemplatedEmail({ template: 'invitation', to: body.email.trim().toLowerCase(), organizationId: body.organizationId, data: { orgName: org.data?.name || '', roleLabel: body.role, inviteUrl: inviteLink, expiresInDays: 7 } });
      emailed = Boolean(sent.delivered);
    } catch { /* A shareable invite remains valid if email delivery fails. */ }
    return platformJson({ success: true, invitationId: result.data.invitationId, inviteLink, emailed });
  } catch { return platformJson({ error: 'Management action unavailable.' }, 503); }
}
