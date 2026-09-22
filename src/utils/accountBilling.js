// Server-only account resolution. Never accept billing IDs from a browser.
export async function billingScope(svc, orgId) {
  const { data, error } = await svc.rpc('billing_scope', { p_org: orgId });
  if (error || !data?.accountId || !Array.isArray(data.organizationIds) || !data.organizationIds.includes(orgId)) {
    throw Object.assign(new Error('Account billing lookup unavailable'), { status: 503 });
  }
  return data;
}

export async function billingAuthority(svc, auth, { purchase = false } = {}) {
  const scope = await billingScope(svc, auth.orgId);
  // Workspace roles never grant authority over another account owner's bill.
  const payer = Boolean(scope.ownerAuthId && scope.ownerAuthId === auth.userId);
  // A co-owner has full billing authority when the plan belongs only to this
  // organization. A shared payer account can include other organizations that
  // this owner does not own; that wider account is still payer-controlled.
  const organizationOwner = auth.role === 'owner' && scope.organizationIds.length === 1;
  if (purchase ? !payer && !organizationOwner : !payer && !organizationOwner && scope.accountId !== auth.orgId) {
    return { scope, denied: true };
  }
  return { scope, denied: false };
}
