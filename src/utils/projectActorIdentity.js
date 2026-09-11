/** Shared service-only database authority; unresolved legacy IDs fail closed. */
export async function projectActorIsOwner(svc, auth, projectId, { allowLegacy = false } = {}) {
  const { data, error } = await svc.rpc('project_actor_is_owner', {
    p_org: auth.orgId, p_project: projectId, p_user: auth.appUserId,
    p_type: auth.userType, p_allow_legacy: allowLegacy,
  });
  if (error) throw new Error('Could not verify typed project ownership');
  return data === true;
}

/** Review delegation does not grant ownership for other project actions. */
export async function projectActorCanReview(svc, auth, projectId, { allowLegacy = false } = {}) {
  const { data, error } = await svc.rpc('project_actor_can_review', {
    p_org: auth.orgId, p_project: projectId, p_user: auth.appUserId,
    p_type: auth.userType, p_allow_legacy: allowLegacy,
  });
  if (error) throw new Error('Could not verify project review authority');
  return data === true;
}

export function isOwnDeveloperWork(auth, ...developerIds) {
  return auth?.userType === 'developer' && Boolean(auth.appUserId) &&
    developerIds.some(id => id != null && String(id) === String(auth.appUserId));
}

export async function projectManagerMatches(svc, auth, project) {
  const { data, error } = await svc.rpc('project_actor_is_manager', {
    p_org: auth.orgId, p_project: project.id, p_user: auth.appUserId, p_type: auth.userType,
  });
  if (error) throw new Error('Could not verify the project manager identity');
  return data === true;
}
