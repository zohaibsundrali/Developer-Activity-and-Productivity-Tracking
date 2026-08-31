-- ============================================================================
--  072 - role_permissions: the one key 071 added
--
--  `project.manage_members` — add and remove people on a project.
--
--  Mirrors migration 068, which generated 160 rows from
--  src/utils/permissionCatalogue.js. That table is a MIRROR: nothing in the
--  application reads it at runtime (the catalogue is the source of truth and
--  resolvePermission never queries the database). It exists so the permission
--  model is inspectable in SQL, and a mirror that is missing a row is a mirror
--  nobody trusts — which is why this file exists rather than the row being left
--  for the next full re-sync.
--
--  DECIDERS = owner, admin, manager. Not team_lead: being able to add yourself
--  to a project would make project scoping self-service and defeat it.
--
--  Safe to run twice.
-- ============================================================================

insert into public.role_permissions (role, resource, action, allowed) values
  ('owner',   'project', 'manage_members', true),
  ('admin',   'project', 'manage_members', true),
  ('manager', 'project', 'manage_members', true)
on conflict (role, resource, action) do update set allowed = excluded.allowed;

-- VERIFY (read-only). Expect 163 rows over 54 distinct keys.
--
--  select count(*) as rows,
--         count(distinct resource || '.' || action) as keys
--    from public.role_permissions;
