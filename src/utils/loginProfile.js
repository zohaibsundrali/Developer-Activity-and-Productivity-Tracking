import { PROFILE_TABLE } from '@/utils/roles';

/** Resolve only the profile named by this successful Auth sign-in. */
export async function loadLoginProfile(client, authUser, userType) {
  if (!authUser?.id) throw new Error('Invalid email or password.');
  const metadata = authUser.app_metadata || {};
  if (!PROFILE_TABLE[userType] || metadata.user_type !== userType) {
    throw new Error('Choose the account type assigned to your account and try again.');
  }
  if (!metadata.app_user_id || !metadata.organization_id) {
    throw new Error('Your workspace account setup needs administrator attention. Please contact your organization administrator.');
  }
  let result;
  try {
    result = await client.from(PROFILE_TABLE[userType]).select('*')
      .eq('id', metadata.app_user_id)
      .eq('organization_id', metadata.organization_id)
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
  } catch {
    throw new Error('Could not verify your workspace account. Please try again.');
  }
  if (result.error) throw new Error('Could not verify your workspace account. Please try again.');
  const profile = result.data;
  if (!profile || profile.id !== metadata.app_user_id ||
      profile.organization_id !== metadata.organization_id || profile.auth_user_id !== authUser.id) {
    throw new Error('Your workspace access could not be confirmed. Your administrator must check your membership and account link.');
  }
  return profile;
}
