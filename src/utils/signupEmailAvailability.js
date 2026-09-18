// Server-only helper: callers supply a service-role client. Never return IDs or
// metadata from the identity tables, or label a developer as a registered admin.
export async function signupEmailConflict(client, email) {
  const { data: status, error } = await client.rpc('signup_email_status', { p_email: email });
  if (error) throw new Error('Signup email lookup unavailable');
  if (status === 'admin_exists') return {
    code: 'account_exists',
    error: 'An admin account with this email is already registered. Please sign in or reset your password.',
  };
  if (status === 'identity_exists') return {
    code: 'email_in_use',
    error: 'This email is linked to an existing account. Please sign in, or use a different email to create an organization.',
  };
  if (status === 'available' || status === 'resumable') return null;
  throw new Error('Signup email lookup unconfirmed');
}
