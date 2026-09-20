import { supabase } from '@/utils/supabaseClient';
import { authFetch } from '@/utils/authFetch';
import { workspaceTokenClaims, sameWorkspace } from '@/utils/workspaceClaims';
import { loadLoginProfile } from '@/utils/loginProfile';
import { loadOrgContext } from '@/utils/orgContext';
import { clearApplicationSessions } from '@/utils/sessionPolicy';
import { loadPermissionSet } from '@/utils/permissions';
import { dashboardHomeFor } from '@/utils/dashboardHome';

export async function openWorkspace({ organizationId, profileId, userType }) {
  const response = await authFetch('/api/organizations/select', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, profileId, userType }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Workspace could not be opened.');
  // From here the old context is invalid. Never return a stale cached identity
  // to the dashboard, even when a refresh or permission request fails.
  clearApplicationSessions();
  await supabase.removeAllChannels();
  await fetch('/api/auth/session', { method: 'DELETE' });
  const { data, error } = await supabase.auth.refreshSession();
  const claims = workspaceTokenClaims(data?.session?.access_token || '');
  if (error || !sameWorkspace(claims?.app_metadata, result.context)) {
    throw new Error('Workspace session could not be refreshed. Please retry opening your organization.');
  }
  const metadata = claims.app_metadata;
  const profile = await loadLoginProfile(supabase, { ...data.user, app_metadata: metadata }, metadata.user_type);
  const org = await loadOrgContext(profile.id, metadata.user_type, organizationId);
  if (org.membershipStatus !== 'active' || org.organizationId !== organizationId || org.membershipRole !== metadata.role) {
    throw new Error('Your workspace membership could not be confirmed.');
  }
  if (!(await loadPermissionSet(authFetch))) throw new Error('Workspace permissions could not be loaded. Please retry.');
  const signed = await authFetch('/api/auth/session', { method: 'POST' });
  if (!signed.ok) throw new Error('A secure workspace session could not be established. Please retry.');
  const now = new Date().toISOString();
  sessionStorage.setItem(`${metadata.user_type}User`, JSON.stringify({ ...profile, role: metadata.user_type,
    membership_role: metadata.role, organization_id: org.organizationId, organization_name: org.organizationName,
    organization_logo: org.organizationLogo, organization_timezone: org.organizationTimezone, loginTime: now, lastActivity: now }));
  // Destroy retained queries, component state and realtime consumers before
  // mounting another organization's dashboard (the same boundary as logout).
  window.location.assign(dashboardHomeFor(metadata.user_type, metadata.role));
}
