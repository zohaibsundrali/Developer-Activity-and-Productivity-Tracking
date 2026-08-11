import { NextResponse } from 'next/server';
import { ROLE_RANK as SHARED_ROLE_RANK, rankOf } from "@/utils/roles";
import crypto from 'crypto';
import { sendTemplatedEmail } from '@/utils/emailService';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';
import { checkSeatLimitForRole, checkFeatureAccess } from '@/utils/entitlements';

// Roles allowed to send invitations.
const INVITER_ROLES = ['owner', 'admin', 'hr', 'manager'];
// Roles that can be assigned via an invitation. "owner" is only grantable by an
// existing owner (guarded below) so a lower role can't escalate someone to owner.
const ASSIGNABLE_ROLES = ['admin', 'manager', 'team_lead', 'hr', 'developer', 'employee', 'client'];
// Mirrors ROLE_RANK in src/utils/permissions.js — an inviter can only grant a
// role that ranks strictly below their own.
// ROLE_RANK is imported, not redeclared. This file kept its own copy, and
// when designer/qa/finance were added it was not updated — so an unknown
// role fell to rank 0, the LOWEST, and sailed through every comparison
// meant to stop someone granting a role at or above their own. See
// src/utils/roles.js.
const ROLE_RANK = SHARED_ROLE_RANK;

// Derive the public origin from request headers (works behind proxies).
function getOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin) return origin;
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : '';
}

export async function POST(request) {
  try {
    // ── Authenticate the caller and derive their org from the JWT ──
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (!INVITER_ROLES.includes(auth.role)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: you cannot send invitations.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { email, role, teamId, departmentId, projectId } = body || {};

    // ── Validate required fields ─────────────────────────
    if (!email || !role) {
      return NextResponse.json(
        { success: false, error: 'email and role are required' },
        { status: 400 }
      );
    }

    // ── Validate the requested role (prevents privilege escalation) ──
    const isOwnerGrant = role === 'owner';
    if (isOwnerGrant && auth.role !== 'owner') {
      return NextResponse.json(
        { success: false, error: 'Only an owner can invite another owner.' },
        { status: 403 }
      );
    }
    if (!isOwnerGrant && !ASSIGNABLE_ROLES.includes(role)) {
      return NextResponse.json(
        { success: false, error: 'Invalid role.' },
        { status: 400 }
      );
    }
    // An inviter may never grant a role at or above their own rank. Without
    // this an hr (rank 5) or manager (rank 6) could invite a full admin
    // (rank 7) and escalate through the invitation flow (audit finding H3).
    // An unknown role used to fall to 0 and pass this check for the wrong
    // reason. rankOf() returns null, treated here as ungrantable rather
    // than as the lowest rank.
    const wantedRank = rankOf(role);
    const callerRank = rankOf(auth.role);
    if (wantedRank === null || callerRank === null || wantedRank >= callerRank) {
      return NextResponse.json(
        { success: false, error: `You cannot invite someone as "${role}".` },
        { status: 403 }
      );
    }

    // Org is taken from the verified JWT — never from the request body.
    const organizationId = auth.orgId;
    const supabase = serviceClient();

    // A client invitation hands out a client-portal login, so it is gated by
    // the plan feature rather than by a seat meter — no seat count counts a
    // client row.
    if (role === 'client') {
      const featureBlock = await checkFeatureAccess(
        supabase,
        organizationId,
        'client_portal',
        'The client portal'
      );
      if (featureBlock) {
        return NextResponse.json(
          { success: false, ...featureBlock },
          { status: featureBlock.status }
        );
      }
    }

    // An invitation is a seat. Checking here rather than at accept time means
    // the org is told before a colleague receives an email they cannot use;
    // the accept path checks again, because this check does not consume
    // anything and ten pending invitations would each see the same free seat.
    // The role decides which meters apply — charging a role to a meter that
    // never counts it leaves that meter unenforced.
    const seatLimit = await checkSeatLimitForRole(supabase, organizationId, role);
    if (seatLimit) {
      return NextResponse.json({ success: false, ...seatLimit }, { status: seatLimit.status });
    }

    const token = crypto.randomUUID();
    const invitedBy = auth.appUserId || null;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // ── Insert the invitation ────────────────────────────
    const { data: invitation, error: insertError } = await supabase
      .from('invitations')
      .insert({
        organization_id: organizationId,
        email,
        role,
        team_id: teamId || null,
        department_id: departmentId || null,
        project_id: projectId || null,
        token,
        status: 'pending',
        invited_by: invitedBy,
        expires_at: expiresAt,
      })
      .select('*')
      .single();

    if (insertError) {
      return NextResponse.json(
        { success: false, error: 'Failed to create invitation', details: insertError.message },
        { status: 500 }
      );
    }

    // ── Best-effort: send the invite email ───────────────
    const origin = getOrigin(request);
    const inviteLink = `${origin}/invite/${token}`;
    let emailed = false;
    let emailMode = null;

    try {
      // Look up the organization name for a friendlier email.
      let orgName = '';
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .maybeSingle();
      if (org && org.name) orgName = org.name;

      const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

      // One send path: the `invitation` template escapes orgName and roleLabel
      // (both were interpolated raw into markup here), the provider seam picks
      // Resend / SMTP / mock, transient failures are retried, and the outcome
      // lands in email_log.
      const sendResult = await sendTemplatedEmail({
        template: 'invitation',
        to: email,
        organizationId,
        data: { orgName, roleLabel, inviteUrl: inviteLink, expiresInDays: 7 },
      });
      emailed = Boolean(sendResult.delivered);
      emailMode = sendResult.mode;
    } catch (emailError) {
      // Best-effort only — invitation still succeeds without the email.
      emailed = false;
    }

    return NextResponse.json({ success: true, invitation, emailed, emailMode });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to process invitation', details: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    // ── Authenticate the caller and scope to their own org ──
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (!INVITER_ROLES.includes(auth.role)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const supabase = serviceClient();

    // Org comes from the verified JWT — a caller can only list their own org's
    // invitations, never another organization's tokens.
    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch invitations', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, invitations: data || [] });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch invitations', details: error.message },
      { status: 500 }
    );
  }
}
