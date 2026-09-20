import { authFetch } from '@/utils/authFetch';
// Navigation hint only. Platform APIs independently re-check live owner access.
export async function platformOwnerHome() {
  try {
    const response = await authFetch('/api/platform/access', { cache: 'no-store' });
    return response.ok && (await response.json()).platformOwner === true;
  } catch { return false; }
}
