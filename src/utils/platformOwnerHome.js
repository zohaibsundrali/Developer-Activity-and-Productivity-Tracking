import { authFetch } from '@/utils/authFetch';
// Navigation hint only. Platform APIs independently re-check live owner access.
export async function platformOwnerHome() {
  try {
    const response = await authFetch('/api/platform/access', { cache: 'no-store' });
    const data = await response.json();
    return (response.ok && (data.platformAccess === true || data.platformOwner === true)) ||
      (response.status === 403 && data.code === 'MFA_REQUIRED' && data.platformAccess === true);
  } catch { return false; }
}
