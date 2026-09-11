import { NextResponse } from 'next/server';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';
import { requirePermission } from '@/utils/serverPermissions';
import { flushProposalDecisionEmails } from '@/utils/proposalDecisionEmails';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS = ['accepted', 'rejected', 'needs_info', 'in_review', 'estimate'];
function numberOrNull(value) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null;
  if (!['string', 'number'].includes(typeof value)) throw new Error('Invalid estimate');
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid estimate');
  return n;
}

/** The database commits the decision, project, client link and delivery intent
 * atomically. Retrying an accepted proposal returns its existing linked project. */
export async function POST(request, { params }) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['admin', 'developer'].includes(auth.userType)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const denied = requirePermission(auth, 'proposal.decide');
    if (denied) return denied;
    const proposalId = (await params)?.id;
    const body = await request.json().catch(() => null);
    if (!UUID.test(proposalId || '') || !body || !DECISIONS.includes(body.decision)) return NextResponse.json({ error: 'Unknown proposal or decision.' }, { status: 400 });
    const decision = body.decision;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const managerId = body.managerId || null;
    const managerType = body.managerType || null;
    if ((managerId && !UUID.test(managerId)) || (managerType && !['admin', 'developer'].includes(managerType)) || (managerType && !managerId))
      return NextResponse.json({ error: 'Invalid manager.' }, { status: 400 });
    if (['rejected', 'needs_info'].includes(decision) && !reason) return NextResponse.json({ error: 'Say why — the client will read this.' }, { status: 400 });
    if (decision === 'accepted') {
      const createDenied = requirePermission(auth, 'project.create');
      if (createDenied) return createDenied;
      if (managerId) {
        const assignmentDenied = requirePermission(auth, 'project.assign_manager');
        if (assignmentDenied) return assignmentDenied;
      }
    }
    let cost = null, hours = null, days = null;
    if (decision === 'estimate') {
      try {
        cost = numberOrNull(body.estimatedCost); hours = numberOrNull(body.estimatedHours);
        days = numberOrNull(body.estimatedTimelineDays);
        if (days !== null) days = Math.round(days);
        if ((cost === null && hours === null) || days > 2147483647) throw new Error('Invalid estimate');
      } catch { return NextResponse.json({ error: 'Give a valid nonnegative cost or hours estimate.' }, { status: 400 }); }
    }
    const svc = serviceClient();
    const { data, error } = await svc.rpc('decide_project_proposal', {
      p_org: auth.orgId, p_proposal: proposalId, p_actor: auth.appUserId, p_actor_type: auth.userType,
      p_decision: decision, p_reason: reason || null, p_manager: managerId, p_manager_type: managerType,
      p_cost: cost, p_hours: hours, p_days: days,
      p_internal_notes: typeof body.internalNotes === 'string' ? body.internalNotes.slice(0, 5000) : null,
    });
    if (error) {
      const message = String(error.message || '');
      const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : error.code === '22023' ? 400
        : /PROPOSAL_CONFLICT/.test(message) ? 409 : /BILLING_LOCKED|QUOTA|PLAN_LIMIT/i.test(message) ? 402 : 503;
      return NextResponse.json({ error: status === 409 ? 'That proposal already has a final decision.' : 'Could not record that decision.' }, { status });
    }
    if (!data?.proposal) return NextResponse.json({ error: 'Decision result unavailable.' }, { status: 503 });
    let notificationWarning;
    if (['accepted', 'rejected', 'needs_info'].includes(decision)) {
      try {
        const delivered = await flushProposalDecisionEmails(svc, proposalId);
        if (delivered.pending) notificationWarning = 'Decision saved. Client email is queued for retry.';
      } catch { notificationWarning = 'Decision saved. Client email is queued for retry.'; }
    }
    return NextResponse.json({ ...data, ...(notificationWarning ? { notificationWarning } : {}) });
  } catch {
    return NextResponse.json({ error: 'Could not record that decision.' }, { status: 503 });
  }
}
