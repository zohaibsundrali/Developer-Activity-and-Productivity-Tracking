import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

function jsonError(message, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonError(
        'Server misconfigured: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
        500
      );
    }

    const body = await request.json().catch(() => ({}));
    const bodyDeveloperId = normalizeString(body?.developerId);

    const cookieStore = await cookies();
    const isLoggedIn = Boolean(cookieStore.get('developer_auth')?.value);
    const developerId = bodyDeveloperId || normalizeString(cookieStore.get('developer_id')?.value);

    if (!isLoggedIn || !developerId) {
      return jsonError('Unauthorized.', 401);
    }
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

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: developer, error: fetchError } = await supabase
      .from('developers')
      .select('id, password')
      .eq('id', developerId)
      .maybeSingle();

    if (fetchError) {
      return jsonError(`Failed to verify current password: ${fetchError.message}`, 500);
    }

    if (!developer) {
      return jsonError('Developer not found.', 404);
    }

    const storedPassword = developer.password;
    const currentPasswordValid = typeof storedPassword === 'string' && storedPassword === currentPassword;

    if (!currentPasswordValid) {
      return jsonError('Current password is incorrect.', 400);
    }

    const { error: updateError } = await supabase
      .from('developers')
      .update({ password: newPassword })
      .eq('id', developerId);

    if (updateError) {
      return jsonError(`Failed to update password: ${updateError.message}`, 500);
    }

    return NextResponse.json({ success: true });
  } catch {
    return jsonError('Unexpected error while updating password.', 500);
  }
}
