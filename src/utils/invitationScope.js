/** Service-role invitation writes must validate every linked tenant resource. */
export async function validateInvitationScope(svc, orgId, { teamId, departmentId, projectId } = {}) {
  for (const [table, id] of [['teams', teamId], ['departments', departmentId], ['projects', projectId]]) {
    if (id == null || id === '') continue;
    if (typeof id !== 'string') return { status: 400, error: 'Invalid invitation resource.' };
    try {
      const { data, error } = await svc.from(table).select('id')
        .eq('id', id).eq('organization_id', orgId).maybeSingle();
      if (error) return { status: 503, error: 'Invitation resources are temporarily unavailable.' };
      if (!data) return { status: 400, error: 'Invitation resources must belong to this organization.' };
    } catch {
      return { status: 503, error: 'Invitation resources are temporarily unavailable.' };
    }
  }
  return null;
}
