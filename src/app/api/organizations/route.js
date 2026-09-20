import { NextResponse } from 'next/server';
import { workspaceIdentity, isUuid } from '@/utils/workspaceIdentity';
import { meta as termsMeta } from '@/content/legal/terms';

export const dynamic = 'force-dynamic';
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request) {
  try {
    const auth = await workspaceIdentity(request);
    if (!auth) return reply({ error: 'Please sign in to view your organizations.' }, 401);
    const { data, error } = await auth.svc.rpc('list_workspaces', { p_auth: auth.user.id });
    if (error || !Array.isArray(data)) return reply({ error: 'Organizations could not be loaded. Please retry.' }, 503);
    return reply({ organizations: data,
      ownerAccount: data.some(org => ['owner', 'admin'].includes(org.role)) || ['owner', 'admin'].includes(auth.user.app_metadata?.role),
      email: auth.user.email, emailVerified: !!auth.user.email_confirmed_at,
      currentOrganizationId: auth.claims.app_metadata?.organization_id || null });
  } catch { return reply({ error: 'Organizations could not be loaded. Please retry.' }, 503); }
}

export async function POST(request) {
  try {
    const auth = await workspaceIdentity(request);
    if (!auth) return reply({ error: 'Please sign in to create an organization.' }, 401);
    if (!auth.user.email_confirmed_at) return reply({ error: 'Verify your account email before creating an organization.' }, 403);
    const body = await request.json();
    if (!isUuid(body?.requestId) || typeof body.company !== 'string' || !body.company.trim() || body.company.length > 200 || body.termsAccepted !== true ||
      ['industry', 'companySize', 'country', 'timezone'].some(key => body[key] != null && (typeof body[key] !== 'string' || body[key].length > 100))) {
      return reply({ error: 'Enter an organization name and accept the Terms of Service.' }, 400);
    }
    const { data, error } = await auth.svc.rpc('create_authenticated_workspace', {
      p_auth: auth.user.id, p_request: body.requestId,
      p_details: { company: body.company.trim(), industry: body.industry, companySize: body.companySize, country: body.country, timezone: body.timezone || 'UTC' },
      p_plan: typeof body.planCode === 'string' ? body.planCode : 'free',
      p_terms: termsMeta.version || termsMeta.lastUpdated,
    });
    if (error) {
      if (error.message?.startsWith('WORKSPACE_RATE_LIMIT')) return reply({ error: 'Please wait before creating another organization.' }, 429);
      if (/^WORKSPACE_(FORBIDDEN|UNAUTHENTICATED)/.test(error.message || '')) return reply({ error: 'Your account access could not be confirmed.' }, 403);
      if (error.message?.startsWith('WORKSPACE_INVALID')) return reply({ error: 'Check your organization details and timezone.' }, 400);
      return reply({ error: 'Organization setup could not be confirmed. Retry to safely resume the same request.' }, 503);
    }
    if (!data?.organizationId || !data?.profileId) return reply({ error: 'Organization setup could not be confirmed. Please retry.' }, 503);
    return reply(data, 201);
  } catch (error) {
    return reply({ error: error instanceof SyntaxError ? 'Invalid request.' : 'Organization setup could not be confirmed. Please retry.' }, error instanceof SyntaxError ? 400 : 503);
  }
}
