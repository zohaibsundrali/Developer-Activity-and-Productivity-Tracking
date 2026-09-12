import { validateInvitationScope } from "@/utils/invitationScope";
import { NextResponse } from 'next/server';
import { ROLES, ROLE_RANK as SHARED_ROLE_RANK, rankOf } from "@/utils/roles";
import crypto from 'crypto';
import { sendTemplatedEmail, isValidEmail } from '@/utils/emailService';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';
import { authCan } from '@/utils/serverPermissions';
import { checkSeatLimitForRole, checkFeatureAccess } from '@/utils/entitlements';

// Roles allowed to send invitations.
// Roles that can be assigned via an invitation: every role except `owner`,
// which is grantable only by an existing owner (guarded below) so a lower role
// cannot escalate someone past themselves.
//
// DERIVED, NOT TYPED OUT — and this is the third time that lesson has been
// learned in this one file. ROLE_RANK below used to be a local copy and went
// stale when designer/qa/finance were added. This list was the same mistake
// one line up and nobody noticed, because it fails in the quietest possible
// way: the invite form offered Finance, QA and Designer, and choosing any of
// them answered `400 Invalid role.` — a role the product had shipped two
// migrations earlier, refused by the one screen that hands it out. `devops`
// (migration 067) never reached the form at all.
const ASSIGNABLE_ROLES = ROLES.filter((r) => r !== 'owner');
// Mirrors ROLE_RANK in src/utils/permissions.js — an inviter can only grant a
// role that ranks strictly below their own.
// ROLE_RANK is imported, not redeclared. This file kept its own copy, and
// when designer/qa/finance were added it was not updated — so an unknown
// role fell to rank 0, the LOWEST, and sailed through every comparison
// meant to stop someone granting a role at or above their own. See
// src/utils/roles.js.
const ROLE_RANK = SHARED_ROLE_RANK;

// Deployment configuration is authoritative. Request headers must never choose
// the host receiving a signup token. Development may use the actual URL.
function getOrigin(request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured && process.env.NODE_ENV === 'production') return null;
  try {
    const url = new URL(configured || request.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) return null;
    return url.origin;
  } catch { return null; }
}

const reply = (body, options = {}) => NextResponse.json(body, {
  ...options, headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
});

export async function POST(request) {
  try {
    // ── Authenticate the caller and derive their org from the JWT ──
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return reply(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    // The rank guard further down is NOT replaced by this: it stops an
    // inviter granting a role at or above their own, which is a comparison
    // between two roles and not a capability the catalogue can express.
    if (!authCan(auth, 'member.invite')) {
      return reply(
        { success: false, error: 'Forbidden: you cannot send invitations.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ success: false, error: "Invalid JSON request" }, { status: 400 });
    const { role, teamId, departmentId, projectId } = body || {};
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    // ── Validate required fields ─────────────────────────
    if (!isValidEmail(email) || !role) {
      return reply(
        { success: false, error: 'A valid email and role are required' },
        { status: 400 }
      );
    }

    // ── Validate the requested role (prevents privilege escalation) ──
    const isOwnerGrant = role === 'owner';
    if (isOwnerGrant && auth.role !== 'owner') {
      return reply(
        { success: false, error: 'Only an owner can invite another owner.' },
        { status: 403 }
      );
    }
    if (!isOwnerGrant && !ASSIGNABLE_ROLES.includes(role)) {
      return reply(
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
      return reply(
        { success: false, error: `You cannot invite someone as "${role}".` },
        { status: 403 }
      );
    }

    // Org is taken from the verified JWT — never from the request body.
    const organizationId = auth.orgId;
    const supabase = serviceClient();

    const scopeError = await validateInvitationScope(supabase, organizationId, { teamId, departmentId, projectId });
    if (scopeError) return reply({ success: false, ...scopeError }, { status: scopeError.status });

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
        return reply(
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
      return reply({ success: false, ...seatLimit }, { status: seatLimit.status });
    }

    const origin = getOrigin(request);
    if (!origin) return reply({ success: false, error: 'Invitation links are not configured. Contact the administrator.' }, { status: 503 });

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
      if (insertError.message?.startsWith('INVITATION_EXISTS')) return reply({ success: false, error: 'An unexpired invitation already exists for this email. Share its link or revoke it before creating another.' }, { status: 409 });
      if (/^(BILLING_LOCKED|PLAN_FEATURE_REQUIRED)/.test(insertError.message || '')) return reply({ success: false, error: 'The organization subscription cannot issue this invitation.' }, { status: 402 });
      return reply(
        { success: false, error: 'Failed to create invitation' },
        { status: 500 }
      );
    }

    // ── Best-effort: send the invite email ───────────────
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

    return reply({ success: true, invitation, emailed, emailMode });
  } catch (error) {
    return reply(
      { success: false, error: 'Failed to process invitation' },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    // ── Authenticate the caller and scope to their own org ──
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return reply(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    // The rank guard further down is NOT replaced by this: it stops an
    // inviter granting a role at or above their own, which is a comparison
    // between two roles and not a capability the catalogue can express.
    if (!authCan(auth, 'member.invite')) {
      return reply(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const supabase = serviceClient();
    const grantableRoles = ROLES.filter(role => rankOf(role) < rankOf(auth.role));

    // Org comes from the verified JWT — a caller can only list their own org's
    // invitations, never another organization's tokens.
    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('organization_id', auth.orgId)
      .in('role', grantableRoles)
      .order('created_at', { ascending: false });

    if (error) {
      return reply(
        { success: false, error: 'Failed to fetch invitations' },
        { status: 500 }
      );
    }

    return reply({ success: true, invitations: data || [] });
  } catch (error) {
    return reply(
      { success: false, error: 'Failed to fetch invitations' },
      { status: 500 }
    );
  }
}
