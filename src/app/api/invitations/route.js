import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';

// Roles allowed to send invitations.
const INVITER_ROLES = ['owner', 'admin', 'hr', 'manager'];
// Roles that can be assigned via an invitation. "owner" is only grantable by an
// existing owner (guarded below) so a lower role can't escalate someone to owner.
const ASSIGNABLE_ROLES = ['admin', 'manager', 'team_lead', 'hr', 'developer', 'employee', 'client'];
// Mirrors ROLE_RANK in src/utils/permissions.js — an inviter can only grant a
// role that ranks strictly below their own.
const ROLE_RANK = {
  owner: 8, admin: 7, manager: 6, hr: 5,
  team_lead: 4, developer: 3, employee: 2, client: 1,
};

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
    if ((ROLE_RANK[role] || 0) >= (ROLE_RANK[auth.role] || 0)) {
      return NextResponse.json(
        { success: false, error: `You cannot invite someone as "${role}".` },
        { status: 403 }
      );
    }

    // Org is taken from the verified JWT — never from the request body.
    const organizationId = auth.orgId;
    const supabase = serviceClient();

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

    try {
      // Look up the organization name for a friendlier email.
      let orgName = '';
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .maybeSingle();
      if (org && org.name) orgName = org.name;

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_EMAIL,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });

      const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

      const mailOptions = {
        from: {
          name: 'Developer Activity Tracking System',
          address: process.env.GMAIL_EMAIL,
        },
        to: email,
        subject: `You've been invited${orgName ? ` to ${orgName}` : ''}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #009578; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1>You're Invited</h1>
            </div>

            <div style="padding: 30px; background: white;">
              <p>Hello,</p>

              <p>You have been invited to join ${orgName ? `<strong>${orgName}</strong>` : 'the workspace'} as a <strong>${roleLabel}</strong>.</p>

              <p>Click the button below to accept your invitation and set up your account:</p>

              <div style="text-align: center; margin: 28px 0;">
                <a href="${inviteLink}" style="background: #009578; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: bold; display: inline-block;">
                  Accept Invitation
                </a>
              </div>

              <p style="font-size: 13px; color: #666;">Or paste this link into your browser:</p>
              <p style="font-size: 13px; word-break: break-all;"><a href="${inviteLink}">${inviteLink}</a></p>

              <p style="font-size: 13px; color: #999; margin-top: 24px;">This invitation expires in 7 days.</p>
            </div>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      emailed = true;
    } catch (emailError) {
      // Best-effort only — invitation still succeeds without the email.
      emailed = false;
    }

    return NextResponse.json({ success: true, invitation, emailed });
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
