import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';
import { recordEvent } from '@/utils/systemEvents';

/**
 * POST /api/developer/change-password — change the caller's own password.
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS A SECURITY BUG
 *  It read `developers.password` (a cleartext column), compared the submitted
 *  current password to it as a string, wrote the new password back into that
 *  same cleartext column, and returned { success: true }. It never touched
 *  Supabase Auth.
 *
 *  Supabase Auth is the authoritative credential. Migration 012 created an auth
 *  user for every profile row and src/app/login/page.js signs in through
 *  supabase.auth.signInWithPassword(). So the old route changed a value nobody
 *  authenticates against: a developer whose password had leaked would rotate
 *  it, be told it worked, and still be signed in to with the leaked password.
 *  It also wrote the brand-new password into a column that RLS exposes to every
 *  authenticated member of the organization (see legacyPassword.js).
 *
 * WHAT IT DOES NOW
 *  1. Resolves the caller's linked Supabase Auth user. No link means the
 *     account cannot have its real credential changed here, and the route says
 *     so instead of succeeding (see LEGACY-ONLY below).
 *  2. Verifies the current password against SUPABASE AUTH, not against the
 *     legacy column. The legacy column may hold a stale value written by the
 *     broken version of this route, so verifying against it would accept a
 *     password the user cannot actually log in with, and reject the one they
 *     can.
 *  3. Changes the real credential with auth.admin.updateUserById(). That is the
 *     whole of the write: no profile-table column is touched at all.
 *
 * WHOSE ACCOUNT IT CHANGES
 *  Always the verified caller's own, never an id from the body. The profile row
 *  used to be looked up in `developers` unconditionally, which meant an admin
 *  calling this route was told "Developer not found." — there was no way for an
 *  admin to change their own password anywhere in the product. The table is now
 *  resolved from the caller's own JWT claims (`user_type` / `app_user_id`, both
 *  verified by getAuthedOrg), so an admin resolves to `admin_users` and everyone
 *  else keeps resolving to `developers` exactly as before. Nothing about the
 *  developer path changed: same table, same messages, same events.
 *
 *  The table is chosen by the token, not by anything the request can say. A body
 *  field naming a table or an account would be a way to point the change at
 *  somebody else's row.
 *
 * LEGACY-ONLY ACCOUNTS
 *  A profile row with auth_user_id null (or pointing at a deleted auth user)
 *  predates the Auth migration or was created by a writer that never
 *  provisioned one. There is no credential this route can legitimately change
 *  for them, and writing the legacy column alone would reproduce exactly the
 *  silent-success bug being fixed. The route returns 409 with a truthful
 *  message and records a system event so the owner can see it happening.
 *  GET /api/admin/legacy-auth-audit counts this population.
 *
 * WHY THE LEGACY COLUMN IS NO LONGER WRITTEN
 *  This route used to re-sync `developers.password` with a PBKDF2 hash of the
 *  new password, so that the fallback branch in src/app/login/page.js would not
 *  keep accepting the OLD password after a rotation. That fallback has now been
 *  deleted: it could only ever run for a caller with no JWT, and every policy on
 *  developers / admin_users / clients is `TO authenticated`, so its profile
 *  lookup returned nothing and the comparison was unreachable.
 *
 *  With no reader left, the sync had no purpose — and a write into a column that
 *  every authenticated member of the organization can `select *` is a cost with
 *  no benefit. So the write is gone. Rotating a password now changes exactly one
 *  thing: the Supabase Auth credential.
 *
 *  The column itself still exists and still holds values written before this
 *  change. Retiring them is stage 5, and dropping the columns is stage 7, of
 *  database/041_password_hardening.sql.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Where a caller's profile row lives, keyed by the `user_type` claim on their
 * verified JWT. `admin_users` and `developers` carry the same three columns this
 * route needs (id, email, auth_user_id) and both are organization-scoped.
 *
 * `notFound` and `label` differ only so the messages and the audit trail name
 * the right kind of account; every rule below is identical for both.
 */
const PROFILE_SOURCES = {
  admin: {
    table: 'admin_users',
    userType: 'admin',
    notFound: 'Account not found.',
    label: 'An admin',
  },
  developer: {
    table: 'developers',
    userType: 'developer',
    notFound: 'Developer not found.',
    label: 'A developer',
  },
};

/**
 * Anything that is not an admin resolves to `developers` — which is where
 * developers, managers, team leads and employees all live, and is exactly what
 * this route did for every caller before admins were added. A client lands here
 * too and gets the same 404 it always did: there is no clients branch, so this
 * opens nothing that was closed.
 */
function profileSourceFor(userType) {
  return userType === 'admin' ? PROFILE_SOURCES.admin : PROFILE_SOURCES.developer;
}

function jsonError(message, status = 400, extra = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

/**
 * Does this sign-in failure mean "wrong password", or something else?
 * Reporting an unconfirmed email or a rate limit as "current password is
 * incorrect" would send the user off to reset a password that is fine.
 */
function classifySignInError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (code === 'email_not_confirmed' || message.includes('not confirmed')) {
    return 'email_not_confirmed';
  }
  if (code === 'over_request_rate_limit' || error?.status === 429 || message.includes('rate limit')) {
    return 'rate_limited';
  }
  if (code === 'invalid_credentials' || error?.status === 400 || message.includes('invalid login')) {
    return 'invalid_credentials';
  }
  return 'unknown';
}

export async function POST(request) {
  let orgIdForEvents = null;
  try {
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonError(
        'Server misconfigured: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
        500
      );
    }
    if (!anonKey) {
      // The current password is verified by attempting a real sign-in, which is
      // an anon-key operation. Without it there is no way to check the current
      // password against the authoritative credential, and the route must not
      // fall back to the legacy column.
      return jsonError(
        'Server misconfigured: missing NEXT_PUBLIC_SUPABASE_ANON_KEY.',
        500
      );
    }

    const auth = await getAuthedOrg(request);
    if (!auth) {
      return jsonError('Unauthorized.', 401);
    }
    // Never trust an account id from the body or a cookie — the target is
    // always the caller themselves.
    const accountId = auth.appUserId;
    if (!accountId) {
      return jsonError('Unauthorized.', 401);
    }
    orgIdForEvents = auth.orgId;

    // Which profile table this caller's row is in. Read off the verified token,
    // never off the request body.
    const profile = profileSourceFor(auth.userType);

    const body = await request.json().catch(() => ({}));
    const currentPassword = normalizeString(body?.currentPassword);
    const newPassword = normalizeString(body?.newPassword);
    const confirmNewPassword = normalizeString(body?.confirmNewPassword);

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return jsonError('All password fields are required.', 400);
    }

    if (newPassword !== confirmNewPassword) {
      return jsonError('New password and confirmation do not match.', 400);
    }

    if (newPassword.length < 8) {
      return jsonError('New password must be at least 8 characters.', 400);
    }

    if (newPassword.length > 128) {
      return jsonError('New password is too long.', 400);
    }

    if (currentPassword === newPassword) {
      return jsonError('New password must be different from current password.', 400);
    }

    const supabase = serviceClient();

    const { data: account, error: fetchError } = await supabase
      .from(profile.table)
      .select('id, email, auth_user_id')
      .eq('id', accountId)
      .eq('organization_id', auth.orgId)
      .maybeSingle();

    if (fetchError) {
      return jsonError(`Failed to load your account: ${fetchError.message}`, 500);
    }

    if (!account) {
      return jsonError(profile.notFound, 404);
    }

    // ── 1. Resolve the authoritative auth user ───────────────────────────
    // Two sources: the profile row's auth_user_id (the stored link, which
    // several writers never back-filled) and auth.userId (the subject of the caller's
    // own verified JWT, which cannot be forged). If both are present they must
    // agree — a row linked to a DIFFERENT auth user than the token belongs to
    // is corrupt, and acting on it would change a third party's credential
    // using a password this caller typed.
    const linkedAuthUserId = account.auth_user_id || null;
    if (linkedAuthUserId && auth.userId && linkedAuthUserId !== auth.userId) {
      await recordEvent({
        orgId: auth.orgId,
        type: 'auth.password_change_blocked',
        severity: 'error',
        source: 'auth',
        message: 'A password change was refused: the profile row is linked to a different auth user than the caller.',
        context: {
          userId: accountId,
          userType: profile.userType,
          route: '/api/developer/change-password',
          reason: 'auth_link_mismatch',
          statusCode: 409,
        },
      });
      return jsonError(
        'Your sign-in record does not match your profile, so the password cannot be changed safely. ' +
          'Nothing was changed. Please contact an administrator.',
        409,
        { code: 'auth_link_mismatch' }
      );
    }

    // The caller reached this route holding a verified Supabase Auth JWT, so an
    // auth user demonstrably exists for them even when the link column was
    // never back-filled. Prefer the stored link, fall back to the token.
    const authUserId = linkedAuthUserId || auth.userId || null;

    let authUser = null;
    if (authUserId) {
      const { data: found } = await supabase.auth.admin.getUserById(authUserId);
      authUser = found?.user || null;
    }

    if (!authUser) {
      // LEGACY-ONLY / DANGLING LINK. Say so; write nothing, report no success.
      //
      // Note on reachability: an account with no auth user at ALL cannot get
      // this far, because they cannot obtain the JWT this route requires — they
      // are turned away at the 401 above, which is itself a symptom nobody can
      // read. That population is counted by GET /api/admin/legacy-auth-audit,
      // which is the whole reason that route exists. What lands here is the
      // narrower case: a link (or token subject) pointing at an auth user that
      // no longer exists.
      await recordEvent({
        orgId: auth.orgId,
        type: 'auth.password_change_blocked',
        severity: 'warning',
        source: 'auth',
        message: 'A password change was refused: the account has no linked Supabase Auth user.',
        context: {
          userId: accountId,
          userType: profile.userType,
          route: '/api/developer/change-password',
          reason: 'legacy_only_account',
          statusCode: 409,
        },
      });
      return jsonError(
        'This account is not linked to the authentication service, so its password cannot be changed here. ' +
          'Nothing was changed. Ask an administrator to provision sign-in for your account, then try again.',
        409,
        { code: 'legacy_only_account' }
      );
    }

    const authEmail = authUser.email || account.email || auth.email || null;
    if (!authEmail) {
      return jsonError(
        'This account has no email address on its sign-in record, so the current password cannot be verified. Nothing was changed.',
        409,
        { code: 'no_auth_email' }
      );
    }

    // ── 2. Verify the CURRENT password against Supabase Auth ─────────────
    // A real sign-in attempt is the only way to check a password Supabase Auth
    // stores hashed. It runs on a throwaway anon client that persists nothing.
    const verifier = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: signIn, error: signInError } = await verifier.auth.signInWithPassword({
      email: authEmail,
      password: currentPassword,
    });

    // Drop the session this check just minted. scope 'local' is deliberate —
    // a global sign-out would revoke the caller's real browser session too.
    try {
      await verifier.auth.signOut({ scope: 'local' });
    } catch {
      /* nothing persisted; failure here is not interesting */
    }

    if (signInError || !signIn?.user) {
      const reason = classifySignInError(signInError);
      if (reason === 'email_not_confirmed') {
        return jsonError(
          'Your sign-in email has not been confirmed yet, so the current password cannot be verified. Nothing was changed.',
          409,
          { code: 'email_not_confirmed' }
        );
      }
      if (reason === 'rate_limited') {
        return jsonError(
          'Too many attempts. Please wait a minute and try again. Nothing was changed.',
          429,
          { code: 'rate_limited' }
        );
      }
      return jsonError('Current password is incorrect.', 400);
    }

    if (signIn.user.id !== authUser.id) {
      // The email resolved to a different auth user than the caller's. Refuse:
      // updating on this basis would change somebody else's credential.
      return jsonError('Current password is incorrect.', 400);
    }

    // ── 3. Change the real credential ────────────────────────────────────
    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(authUser.id, {
      password: newPassword,
    });

    if (authUpdateError) {
      // Nothing has been written yet, so the account is untouched.
      await recordEvent({
        orgId: auth.orgId,
        type: 'auth.password_change_failed',
        severity: 'error',
        source: 'auth',
        message: `Updating the Supabase Auth credential failed: ${authUpdateError.message}`,
        context: {
          userId: accountId,
          userType: profile.userType,
          route: '/api/developer/change-password',
          reason: 'auth_update_failed',
          statusCode: 500,
        },
      });
      return jsonError(`Failed to update password: ${authUpdateError.message}`, 500);
    }

    // ── 4. Nothing else is written ───────────────────────────────────────
    // The legacy password-column re-sync that used to sit here is gone
    // with the login fallback it existed for — see the header block. The
    // credential change above is the entire effect of this route.

    await recordEvent({
      orgId: auth.orgId,
      type: 'auth.password_changed',
      severity: 'info',
      source: 'auth',
      message: `${profile.label} changed their own password.`,
      context: {
        userId: accountId,
        userType: profile.userType,
        route: '/api/developer/change-password',
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    await recordEvent({
      orgId: orgIdForEvents,
      type: 'auth.password_change_failed',
      severity: 'error',
      source: 'auth',
      message: `Unexpected error while updating a password: ${err?.message || 'no detail'}`,
      context: { route: '/api/developer/change-password', reason: 'unexpected_error', statusCode: 500 },
    });
    return jsonError('Unexpected error while updating password.', 500);
  }
}
