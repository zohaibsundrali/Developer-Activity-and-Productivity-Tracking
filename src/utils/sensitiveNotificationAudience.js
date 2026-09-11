import { loadOverrides } from '@/utils/permissionOverrides';
import { authCan } from '@/utils/serverPermissions';
import { filterForViewer } from '@/utils/signals';

/** Verify every recipient's effective permissions once per cron batch. */
export async function sensitiveNotificationAudience(svc, members, orgId) {
  const audience = [];
  let failed = 0;
  for (let offset = 0; offset < members.length; offset += 20) {
    const batch = await Promise.all(members.slice(offset, offset + 20).map(async member => {
      if (!['admin', 'developer'].includes(member.user_type) || member.status !== 'active' || member.role === 'client' ||
        !(member.organization_id || orgId) || (orgId && member.organization_id && member.organization_id !== orgId)) return null;
      const auth = { orgId: member.organization_id || orgId, appUserId: member.user_id, userType: member.user_type, role: member.role, email: member.email };
      try { auth.overrides = await loadOverrides(svc, auth); return { member, auth }; }
      catch { failed += 1; return null; }
    }));
    audience.push(...batch.filter(Boolean));
  }
  return { audience, failed };
}
export function canReceiveBillingNotice(auth) { return authCan(auth, 'billing.view'); }
export function canReceiveSignalNotice(auth, signal, reportsTo) {
  if (!authCan(auth, 'signal.view')) return false;
  if ((signal.kind === 'plan_pressure' || signal.subject?.type === 'plan') && !authCan(auth, 'billing.view')) return false;
  const ids = [auth.appUserId, auth.email].filter(Boolean).map(value => String(value).trim().toLowerCase());
  const visiblePeople = new Set(Object.entries(reportsTo || {}).filter(([, manager]) => ids.includes(manager)).map(([subject]) => subject));
  return filterForViewer([signal], { role: auth.role, canView: true, canViewBilling: authCan(auth, 'billing.view'), visiblePeople }).length === 1;
}
