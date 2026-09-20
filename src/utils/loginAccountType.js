// Called only after Supabase verifies the submitted credentials. Never infer
// access from the email, user-editable metadata, or a role selected in the UI.
export function loginAccountType(authUser) {
  const type = authUser?.app_metadata?.user_type;
  if (!authUser?.id || !['admin', 'developer', 'client'].includes(type)) {
    throw new Error('Your workspace account setup needs administrator attention. Please contact your organization administrator.');
  }
  return type;
}
