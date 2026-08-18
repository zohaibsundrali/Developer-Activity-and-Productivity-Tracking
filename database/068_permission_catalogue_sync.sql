-- ============================================================================
--  068 — repair role_permissions against the permission catalogue
-- ============================================================================
--
--  WHAT IS WRONG WITH THE TABLE TODAY
--
--  `role_permissions` has existed since migration 010 and holds 39 rows. It is
--  readable by any authenticated user (migration 013, policy rp_read). And it
--  is wrong in three ways at once:
--
--    1. FOUR ROLES ARE ABSENT. It knows owner, admin, manager, developer,
--       employee, client, team_lead and hr. `qa`, `designer` and `finance`
--       arrived in migration 058; `devops` arrived in 067. None of them has a
--       single row.
--
--    2. THE VERBS DISAGREE WITH THEMSELVES. manager and developer rows use
--       `view` / `update` / `manage` / `create` / `review`. team_lead and hr
--       rows use `read`. A check written against `view` answers false for half
--       the organization; a check written against `read` answers false for the
--       other half.
--
--    3. NOTHING READS IT. src/utils/permissions.js says so in a comment. So
--       none of the above has ever broken anything — it is a wrong answer
--       nobody has asked yet.
--
--  A table that is readable, wrong, and unused is a trap for whoever wires it
--  up first. This migration makes it agree with the catalogue that the
--  application actually uses.
--
--  WHAT THIS DOES NOT DO
--
--  It does NOT make the table authoritative. src/utils/permissionCatalogue.js
--  remains the source of truth and the application does not query this table.
--  That is deliberate: a permission check that needs a round trip cannot run in
--  edge middleware, and a resolver that depends on a table can fail open when
--  the table is unreachable. This table becomes the OVERRIDE layer in the next
--  phase — a tenant that wants something other than the shipped defaults — and
--  these rows are the defaults it will be compared against.
--
--  DESTRUCTIVE? It replaces the contents of one configuration table. It touches
--  no user data, no projects, no tasks, no memberships. The DELETE below
--  removes 39 rows that nothing reads. It is wrapped in a transaction and the
--  verification query at the bottom tells you whether it did what it claims.
--
--  GENERATED FROM THE CATALOGUE, not typed. Regenerate rather than hand-edit;
--  hand-editing is how the table drifted from the code in the first place.
--
--  HOW TO RUN IT: Supabase dashboard → SQL Editor → paste this whole file →
--  Run. Then run the VERIFY block at the bottom separately and check the
--  numbers.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The role CHECK constraint, so the four newer roles can be stored here.
--    Mirrors the constraint on `memberships` from migration 067.
-- ---------------------------------------------------------------------------
alter table public.role_permissions
  drop constraint if exists role_permissions_role_check;

alter table public.role_permissions
  add constraint role_permissions_role_check
  check (role in ('owner','admin','manager','hr','finance','team_lead',
                  'qa','developer','designer','devops','employee','client'));

-- ---------------------------------------------------------------------------
-- 2. Replace the contents. Not an upsert: the old rows use a verb vocabulary
--    that no longer exists ('read'), so merging would leave both spellings in
--    the table and the ambiguity is the bug.
-- ---------------------------------------------------------------------------
delete from public.role_permissions;

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
  ('owner', 'monitoring', 'view', true),
  ('admin', 'monitoring', 'view', true),
  ('owner', 'automation', 'manage', true),
  ('admin', 'automation', 'manage', true),
  ('owner', 'system', 'health', true),
  ('admin', 'system', 'health', true),
  ('owner', 'system', 'audit', true),
  ('admin', 'system', 'audit', true),
  ('owner', 'signal', 'view', true),
  ('admin', 'signal', 'view', true),
  ('hr', 'signal', 'view', true),
  ('manager', 'signal', 'view', true),
  ('team_lead', 'signal', 'view', true);

commit;

-- ============================================================================
--  VERIFY — run this separately, after the transaction above has committed.
-- ============================================================================
--
--  Expect: 160 rows, 51 distinct permissions, 11 roles with at least one row.
--  `client` correctly has ZERO: the customer portal is gated end to end by
--  user_type and project ownership, and no staff capability names it.
--
--  select count(*) as rows from public.role_permissions;
--    -> 160
--
--  select count(distinct (resource || '.' || action)) as permissions
--    from public.role_permissions;
--    -> 51
--
--  select role, count(*) from public.role_permissions group by role order by 2 desc;
--    -> owner 50, admin 46, manager 22, team_lead 17, hr 15, qa 3,
--       finance 3, developer 1, designer 1, devops 1, employee 1
--
--    (These were counted from the generated rows, not estimated. An earlier
--    draft of this block carried guessed numbers — a verification step whose
--    expectations are wrong is worse than no verification step, because it
--    trains you to ignore it.)
--
--  -- the verbs are now one vocabulary; this must return no rows:
--  select distinct action from public.role_permissions where action = 'read';
--    -> (0 rows)
--
--  -- the four roles that had none must now have some:
--  select role, count(*) from public.role_permissions
--   where role in ('qa','designer','devops','finance') group by role;
--    -> four rows, none zero
-- ============================================================================
