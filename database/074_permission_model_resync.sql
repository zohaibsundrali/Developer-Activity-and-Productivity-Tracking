-- ============================================================================
--  074 - role_permissions: a full re-sync, and the *_own family it exists for
--
--  WHAT 074 ADDS TO THE MODEL
--
--  Nine `*_own` keys. Before them a developer held exactly ONE permission out
--  of fifty-three -- task.submit -- and everything else they do all day (open
--  their task list, log an hour, read their own recorded activity) had no
--  permission expression anywhere in the product. Those screens worked because
--  RLS scopes rows to the signed-in user. That is a real gate and it is the
--  LAST one; it answers an empty list, not a 403, and nothing could write down
--  "may this person log time" -- so no route could ask it and permissions.manage
--  could not revoke it.
--
--  Every staff role holds all nine, owner included: an owner has a timesheet
--  too. What separates the roles is whether they may see ANYBODY ELSE'S, and
--  that is always a different key -- task.view_all beside task.view_own,
--  report.view beside productivity.view_own, monitoring.view beside
--  monitoring.view_own. `client` holds none of them.
--
--  Plus two keys that name rules the routes were already enforcing in terms of
--  `user_type`, a STORAGE column: hierarchy.manage (owner/admin/hr, matching
--  the memberships_update policy in 018) and productivity.recalculate
--  (owner/admin, which is what `userType !== 'admin'` meant).
--
--  WHY A FULL RE-SYNC AND NOT 104 NEW ROWS
--
--  role_permissions is a MIRROR -- nothing reads it at runtime, the catalogue
--  is the source of truth and resolvePermission never queries the database. It
--  exists so the model is inspectable in SQL. 068 generated it; 072 topped it
--  up by hand. The arithmetic in 072's own verify comment expects 163 rows over
--  54 keys, and the catalogue for those same 54 keys comes to 167 -- four rows
--  the mirror never received, because a key added after 068 landed without a
--  migration behind it. A mirror that is four rows wrong is a mirror nobody
--  checks against. Every row is regenerated FROM the catalogue here, so the
--  count below is a fact about this file rather than a running total somebody
--  has to keep adding to.
--
--  NOTHING IS DELETED. Upsert only. If a key was renamed, its old rows are
--  still here -- PART 3 is a read-only query that lists them for you to look at
--  before deciding. Deleting them is not this file's call to make.
--
--  Safe to run twice.
-- ============================================================================

-- PART 1 -- every row the catalogue defines. 271 rows over 65 keys.
insert into public.role_permissions (role, resource, action, allowed) values
  ('owner', 'organization', 'manage', true),
  ('owner', 'organization', 'settings', true),
  ('owner', 'organization', 'delete', true),
  ('owner', 'organization', 'view', true),
  ('admin', 'organization', 'view', true),
  ('hr', 'organization', 'view', true),
  ('owner', 'member', 'view', true),
  ('admin', 'member', 'view', true),
  ('hr', 'member', 'view', true),
  ('owner', 'member', 'manage', true),
  ('admin', 'member', 'manage', true),
  ('hr', 'member', 'manage', true),
  ('owner', 'member', 'invite', true),
  ('admin', 'member', 'invite', true),
  ('hr', 'member', 'invite', true),
  ('manager', 'member', 'invite', true),
  ('owner', 'member', 'provision', true),
  ('admin', 'member', 'provision', true),
  ('hr', 'member', 'provision', true),
  ('manager', 'member', 'provision', true),
  ('owner', 'member', 'create', true),
  ('admin', 'member', 'create', true),
  ('hr', 'member', 'create', true),
  ('owner', 'member', 'delete', true),
  ('admin', 'member', 'delete', true),
  ('owner', 'member', 'sync_roles', true),
  ('admin', 'member', 'sync_roles', true),
  ('owner', 'employee', 'manage', true),
  ('admin', 'employee', 'manage', true),
  ('hr', 'employee', 'manage', true),
  ('owner', 'employee', 'onboard', true),
  ('admin', 'employee', 'onboard', true),
  ('hr', 'employee', 'onboard', true),
  ('owner', 'employee', 'transfer', true),
  ('admin', 'employee', 'transfer', true),
  ('hr', 'employee', 'transfer', true),
  ('owner', 'employee', 'activate', true),
  ('admin', 'employee', 'activate', true),
  ('hr', 'employee', 'activate', true),
  ('owner', 'team', 'manage', true),
  ('admin', 'team', 'manage', true),
  ('hr', 'team', 'manage', true),
  ('owner', 'hierarchy', 'view', true),
  ('admin', 'hierarchy', 'view', true),
  ('hr', 'hierarchy', 'view', true),
  ('manager', 'hierarchy', 'view', true),
  ('team_lead', 'hierarchy', 'view', true),
  ('owner', 'hierarchy', 'manage', true),
  ('admin', 'hierarchy', 'manage', true),
  ('hr', 'hierarchy', 'manage', true),
  ('owner', 'capacity', 'view', true),
  ('admin', 'capacity', 'view', true),
  ('hr', 'capacity', 'view', true),
  ('manager', 'capacity', 'view', true),
  ('team_lead', 'capacity', 'view', true),
  ('owner', 'team_stats', 'view', true),
  ('admin', 'team_stats', 'view', true),
  ('hr', 'team_stats', 'view', true),
  ('owner', 'team', 'view', true),
  ('admin', 'team', 'view', true),
  ('manager', 'team', 'view', true),
  ('team_lead', 'team', 'view', true),
  ('owner', 'project', 'view_all', true),
  ('admin', 'project', 'view_all', true),
  ('manager', 'project', 'view_all', true),
  ('team_lead', 'project', 'view_all', true),
  ('owner', 'project', 'create', true),
  ('admin', 'project', 'create', true),
  ('manager', 'project', 'create', true),
  ('team_lead', 'project', 'create', true),
  ('owner', 'project', 'delete', true),
  ('admin', 'project', 'delete', true),
  ('owner', 'project', 'assign_manager', true),
  ('admin', 'project', 'assign_manager', true),
  ('owner', 'project', 'manage_members', true),
  ('admin', 'project', 'manage_members', true),
  ('manager', 'project', 'manage_members', true),
  ('owner', 'project', 'close', true),
  ('admin', 'project', 'close', true),
  ('owner', 'project', 'complete', true),
  ('admin', 'project', 'complete', true),
  ('manager', 'project', 'complete', true),
  ('team_lead', 'project', 'complete', true),
  ('owner', 'project', 'hub', true),
  ('admin', 'project', 'hub', true),
  ('manager', 'project', 'hub', true),
  ('team_lead', 'project', 'hub', true),
  ('owner', 'project', 'board', true),
  ('admin', 'project', 'board', true),
  ('owner', 'task', 'manage', true),
  ('admin', 'task', 'manage', true),
  ('manager', 'task', 'manage', true),
  ('team_lead', 'task', 'manage', true),
  ('owner', 'task', 'view_all', true),
  ('admin', 'task', 'view_all', true),
  ('manager', 'task', 'view_all', true),
  ('team_lead', 'task', 'view_all', true),
  ('owner', 'task', 'review', true),
  ('admin', 'task', 'review', true),
  ('manager', 'task', 'review', true),
  ('team_lead', 'task', 'review', true),
  ('qa', 'task', 'review', true),
  ('developer', 'task', 'submit', true),
  ('designer', 'task', 'submit', true),
  ('devops', 'task', 'submit', true),
  ('qa', 'task', 'submit', true),
  ('employee', 'task', 'submit', true),
  ('team_lead', 'task', 'submit', true),
  ('owner', 'sprint', 'view', true),
  ('admin', 'sprint', 'view', true),
  ('manager', 'sprint', 'view', true),
  ('team_lead', 'sprint', 'view', true),
  ('owner', 'bug', 'triage', true),
  ('admin', 'bug', 'triage', true),
  ('manager', 'bug', 'triage', true),
  ('team_lead', 'bug', 'triage', true),
  ('qa', 'bug', 'triage', true),
  ('owner', 'proposal', 'view', true),
  ('admin', 'proposal', 'view', true),
  ('manager', 'proposal', 'view', true),
  ('team_lead', 'proposal', 'view', true),
  ('owner', 'proposal', 'decide', true),
  ('admin', 'proposal', 'decide', true),
  ('manager', 'proposal', 'decide', true),
  ('owner', 'change_request', 'view', true),
  ('admin', 'change_request', 'view', true),
  ('manager', 'change_request', 'view', true),
  ('team_lead', 'change_request', 'view', true),
  ('owner', 'change_request', 'create', true),
  ('admin', 'change_request', 'create', true),
  ('manager', 'change_request', 'create', true),
  ('owner', 'change_request', 'decide', true),
  ('admin', 'change_request', 'decide', true),
  ('manager', 'change_request', 'decide', true),
  ('owner', 'change_request', 'approve', true),
  ('admin', 'change_request', 'approve', true),
  ('owner', 'client', 'view', true),
  ('admin', 'client', 'view', true),
  ('finance', 'client', 'view', true),
  ('owner', 'client', 'notify', true),
  ('admin', 'client', 'notify', true),
  ('manager', 'client', 'notify', true),
  ('owner', 'task', 'set_client_visibility', true),
  ('admin', 'task', 'set_client_visibility', true),
  ('manager', 'task', 'set_client_visibility', true),
  ('owner', 'task', 'view_own', true),
  ('admin', 'task', 'view_own', true),
  ('manager', 'task', 'view_own', true),
  ('hr', 'task', 'view_own', true),
  ('finance', 'task', 'view_own', true),
  ('team_lead', 'task', 'view_own', true),
  ('qa', 'task', 'view_own', true),
  ('developer', 'task', 'view_own', true),
  ('designer', 'task', 'view_own', true),
  ('devops', 'task', 'view_own', true),
  ('employee', 'task', 'view_own', true),
  ('owner', 'task', 'update_own', true),
  ('admin', 'task', 'update_own', true),
  ('manager', 'task', 'update_own', true),
  ('hr', 'task', 'update_own', true),
  ('finance', 'task', 'update_own', true),
  ('team_lead', 'task', 'update_own', true),
  ('qa', 'task', 'update_own', true),
  ('developer', 'task', 'update_own', true),
  ('designer', 'task', 'update_own', true),
  ('devops', 'task', 'update_own', true),
  ('employee', 'task', 'update_own', true),
  ('owner', 'project', 'view_own', true),
  ('admin', 'project', 'view_own', true),
  ('manager', 'project', 'view_own', true),
  ('hr', 'project', 'view_own', true),
  ('finance', 'project', 'view_own', true),
  ('team_lead', 'project', 'view_own', true),
  ('qa', 'project', 'view_own', true),
  ('developer', 'project', 'view_own', true),
  ('designer', 'project', 'view_own', true),
  ('devops', 'project', 'view_own', true),
  ('employee', 'project', 'view_own', true),
  ('owner', 'timesheet', 'view_own', true),
  ('admin', 'timesheet', 'view_own', true),
  ('manager', 'timesheet', 'view_own', true),
  ('hr', 'timesheet', 'view_own', true),
  ('finance', 'timesheet', 'view_own', true),
  ('team_lead', 'timesheet', 'view_own', true),
  ('qa', 'timesheet', 'view_own', true),
  ('developer', 'timesheet', 'view_own', true),
  ('designer', 'timesheet', 'view_own', true),
  ('devops', 'timesheet', 'view_own', true),
  ('employee', 'timesheet', 'view_own', true),
  ('owner', 'timesheet', 'log_own', true),
  ('admin', 'timesheet', 'log_own', true),
  ('manager', 'timesheet', 'log_own', true),
  ('hr', 'timesheet', 'log_own', true),
  ('finance', 'timesheet', 'log_own', true),
  ('team_lead', 'timesheet', 'log_own', true),
  ('qa', 'timesheet', 'log_own', true),
  ('developer', 'timesheet', 'log_own', true),
  ('designer', 'timesheet', 'log_own', true),
  ('devops', 'timesheet', 'log_own', true),
  ('employee', 'timesheet', 'log_own', true),
  ('owner', 'team', 'view_own', true),
  ('admin', 'team', 'view_own', true),
  ('manager', 'team', 'view_own', true),
  ('hr', 'team', 'view_own', true),
  ('finance', 'team', 'view_own', true),
  ('team_lead', 'team', 'view_own', true),
  ('qa', 'team', 'view_own', true),
  ('developer', 'team', 'view_own', true),
  ('designer', 'team', 'view_own', true),
  ('devops', 'team', 'view_own', true),
  ('employee', 'team', 'view_own', true),
  ('owner', 'profile', 'manage_own', true),
  ('admin', 'profile', 'manage_own', true),
  ('manager', 'profile', 'manage_own', true),
  ('hr', 'profile', 'manage_own', true),
  ('finance', 'profile', 'manage_own', true),
  ('team_lead', 'profile', 'manage_own', true),
  ('qa', 'profile', 'manage_own', true),
  ('developer', 'profile', 'manage_own', true),
  ('designer', 'profile', 'manage_own', true),
  ('devops', 'profile', 'manage_own', true),
  ('employee', 'profile', 'manage_own', true),
  ('owner', 'productivity', 'view_own', true),
  ('admin', 'productivity', 'view_own', true),
  ('manager', 'productivity', 'view_own', true),
  ('hr', 'productivity', 'view_own', true),
  ('finance', 'productivity', 'view_own', true),
  ('team_lead', 'productivity', 'view_own', true),
  ('qa', 'productivity', 'view_own', true),
  ('developer', 'productivity', 'view_own', true),
  ('designer', 'productivity', 'view_own', true),
  ('devops', 'productivity', 'view_own', true),
  ('employee', 'productivity', 'view_own', true),
  ('owner', 'monitoring', 'view_own', true),
  ('admin', 'monitoring', 'view_own', true),
  ('manager', 'monitoring', 'view_own', true),
  ('hr', 'monitoring', 'view_own', true),
  ('finance', 'monitoring', 'view_own', true),
  ('team_lead', 'monitoring', 'view_own', true),
  ('qa', 'monitoring', 'view_own', true),
  ('developer', 'monitoring', 'view_own', true),
  ('designer', 'monitoring', 'view_own', true),
  ('devops', 'monitoring', 'view_own', true),
  ('employee', 'monitoring', 'view_own', true),
  ('owner', 'billing', 'view', true),
  ('admin', 'billing', 'view', true),
  ('finance', 'billing', 'view', true),
  ('owner', 'billing', 'manage', true),
  ('admin', 'billing', 'manage', true),
  ('finance', 'billing', 'manage', true),
  ('owner', 'billing', 'purchase', true),
  ('owner', 'report', 'view', true),
  ('admin', 'report', 'view', true),
  ('manager', 'report', 'view', true),
  ('team_lead', 'report', 'view', true),
  ('owner', 'productivity', 'recalculate', true),
  ('admin', 'productivity', 'recalculate', true),
  ('owner', 'monitoring', 'view', true),
  ('admin', 'monitoring', 'view', true),
  ('owner', 'automation', 'manage', true),
  ('admin', 'automation', 'manage', true),
  ('owner', 'system', 'health', true),
  ('admin', 'system', 'health', true),
  ('owner', 'system', 'audit', true),
  ('admin', 'system', 'audit', true),
  ('owner', 'permissions', 'manage', true),
  ('owner', 'signal', 'view', true),
  ('admin', 'signal', 'view', true),
  ('hr', 'signal', 'view', true),
  ('manager', 'signal', 'view', true),
  ('team_lead', 'signal', 'view', true)
on conflict (role, resource, action) do update set allowed = excluded.allowed;


-- PART 2 -- VERIFY (read-only). Expect 271 rows over 65 keys,
-- and zero mismatches.
--
--  select count(*) as rows,
--         count(distinct resource || '.' || action) as keys,
--         count(*) filter (where allowed is not true) as not_allowed
--    from public.role_permissions;

-- PART 3 -- ORPHANS (read-only). Rows whose key is no longer in the catalogue.
-- Expect zero. Anything listed is a key that was renamed or removed in the
-- application without the mirror being told; read it, then decide.
--
--  select role, resource, action
--    from public.role_permissions
--   where (resource || '.' || action) not in (
--       'organization.manage'
--     , 'organization.settings'
--     , 'organization.delete'
--     , 'organization.view'
--     , 'member.view'
--     , 'member.manage'
--     , 'member.invite'
--     , 'member.provision'
--     , 'member.create'
--     , 'member.delete'
--     , 'member.sync_roles'
--     , 'employee.manage'
--     , 'employee.onboard'
--     , 'employee.transfer'
--     , 'employee.activate'
--     , 'team.manage'
--     , 'hierarchy.view'
--     , 'hierarchy.manage'
--     , 'capacity.view'
--     , 'team_stats.view'
--     , 'team.view'
--     , 'project.view_all'
--     , 'project.create'
--     , 'project.delete'
--     , 'project.assign_manager'
--     , 'project.manage_members'
--     , 'project.close'
--     , 'project.complete'
--     , 'project.hub'
--     , 'project.board'
--     , 'task.manage'
--     , 'task.view_all'
--     , 'task.review'
--     , 'task.submit'
--     , 'sprint.view'
--     , 'bug.triage'
--     , 'proposal.view'
--     , 'proposal.decide'
--     , 'change_request.view'
--     , 'change_request.create'
--     , 'change_request.decide'
--     , 'change_request.approve'
--     , 'client.view'
--     , 'client.notify'
--     , 'task.set_client_visibility'
--     , 'task.view_own'
--     , 'task.update_own'
--     , 'project.view_own'
--     , 'timesheet.view_own'
--     , 'timesheet.log_own'
--     , 'team.view_own'
--     , 'profile.manage_own'
--     , 'productivity.view_own'
--     , 'monitoring.view_own'
--     , 'billing.view'
--     , 'billing.manage'
--     , 'billing.purchase'
--     , 'report.view'
--     , 'productivity.recalculate'
--     , 'monitoring.view'
--     , 'automation.manage'
--     , 'system.health'
--     , 'system.audit'
--     , 'permissions.manage'
--     , 'signal.view'
--   )
--   order by resource, action, role;
