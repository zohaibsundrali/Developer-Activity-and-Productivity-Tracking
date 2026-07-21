import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

// Service-role client (falls back to anon key) for privileged inserts/reads.
function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Derive the public origin from request headers (works behind proxies).
function getOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin) return origin;
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : '';
}

// Read a cookie value from the request cookie header.
function getCookie(request, name) {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  const match = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { organizationId, email, role, teamId, departmentId } = body || {};

    // ── Validate required fields ─────────────────────────
    if (!organizationId || !email || !role) {
      return NextResponse.json(
        { success: false, error: 'organizationId, email and role are required' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    const token = crypto.randomUUID();
    const invitedBy = getCookie(request, 'admin_id') || null;
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
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json(
        { success: false, error: 'organizationId is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('organization_id', organizationId)
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
