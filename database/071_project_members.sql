-- ============================================================================
--  071 - project_members: who is on a project, and in what capacity
--
--  THE GAP THIS FILLS
--
--  src/utils/permissionEngine.js has supported project-scoped permissions since
--  it was written:
--
--      if (projectId && projectRoles) {
--        const projectRole = own(projectRoles, projectId);
--        if (typeof projectRole === "string" && allowed.includes(projectRole))
--          return true;
--      }
--
--  Nothing has ever populated `projectRoles`. Across the whole repository the
--  word appears only in that file and its own comments; no route passes
--  `scope.projectId`. Half the permission engine was dead code.
--
--  The consequence is not cosmetic. Every `manager` and `team_lead` permission
--  is ORGANIZATION-wide, so a project manager sees, edits and completes EVERY
--  project in the company. In a software house a PM owns two or three.
--
--  WHY THIS IS NOT A FOURTH SOURCE OF TRUTH
--
--  It was rejected once before, correctly, on the grounds that project
--  assignment already had several homes. Looking at what those actually are:
--
--    projects.assigned_to           ONE developer      (schema.sql:83, FK)
--    projects.manager_id            ONE membership     (016_enterprise_pm.sql:27)
--    developer_tasks.developer_id   task assignment, a CONSEQUENCE of being on
--                                   a project, not a statement of role on it
--
--  None of them can express "three developers, a designer and a QA are on this
--  project, and Ayesha is the team lead". There is no existing table this
--  duplicates, because there is no existing table that answers the question.
--
--  The two single-valued columns are NOT retired here - every read path in the
--  application still uses them and this migration changes none of that. What it
--  does is backfill from them and then keep `manager_id` and the matching
--  project_members row in step with a trigger, so the two cannot drift.
--
--  ROLE NAMES MATCH THE CATALOGUE ON PURPOSE. The engine compares projectRole
--  against defaultRolesFor(key), which holds catalogue role names. A separate
--  vocabulary here would need a mapping table, and a mapping table is the thing
--  that goes stale.
--
--  SAFE TO RUN. Creates one table, its policies, one function and one trigger,
--  and inserts derived rows. Drops nothing. Alters no existing column. Deletes
--  no data. Re-runnable: every insert is ON CONFLICT DO NOTHING.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The table
-- ---------------------------------------------------------------------
create table if not exists public.project_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,

  -- A membership user_id. Deliberately a loose uuid and not a foreign key,
  -- for the same reason projects.manager_id is: a person lives in admin_users
  -- OR developers depending on their user_type, and one column cannot
  -- reference two tables. `user_type` says which.
  user_id          uuid not null,
  user_type        text not null default 'developer'
                     check (user_type in ('admin','developer')),

  -- The catalogue's own role names. 'owner', 'admin' and 'client' are excluded:
  -- the first two are organization-wide by definition and gain nothing from a
  -- project scope, and a client's access is decided by project_clients, which
  -- is a different question with a different answer.
  project_role     text not null
                     check (project_role in
                       ('manager','team_lead','qa','developer','designer','devops','employee')),

  -- Percent of a person's time this project is meant to take. Nullable, because
  -- it is unknown for every backfilled row and inventing 100 would make the
  -- capacity screen confidently wrong. Capacity planning reads this later.
  allocation_pct   integer check (allocation_pct is null
                                  or (allocation_pct >= 0 and allocation_pct <= 100)),

  added_by         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- One row per person per project. A person has ONE capacity on a project;
  -- two rows would make `projectRoles[projectId]` ambiguous and the engine
  -- reads a single string.
  constraint project_members_unique unique (project_id, user_id)
);

create index if not exists project_members_project_idx on public.project_members(project_id);
create index if not exists project_members_user_idx    on public.project_members(user_id);
create index if not exists project_members_org_idx     on public.project_members(organization_id);


-- ---------------------------------------------------------------------
--  PART 2 - RLS
-- ---------------------------------------------------------------------
--  READ: any non-client member of the organization. Knowing who is on which
--  project is ordinary workplace information, and the sidebar already shows
--  colleagues. Clients are excluded - the staffing of their project is not
--  theirs to see, and 014 excludes them from `memberships` for the same reason.
--
--  WRITE: owner, admin, manager. This mirrors `project.assign_manager`
--  (owner+admin) widened by one, because assembling a project team is what a
--  manager does. It is NOT widened to team_lead: being able to add yourself to
--  a project would make project scoping self-service, which would defeat it.
--
--  Note the asymmetry with the trigger in 070: there, the API route was
--  exempted because it carried a stronger rule. Here the API layer will ALSO
--  check `project.assign_manager`; this policy is the floor under it for the
--  direct-PostgREST path the browser can always take.

alter table public.project_members enable row level security;

drop policy if exists project_members_read on public.project_members;
create policy project_members_read on public.project_members
  for select to authenticated
  using (organization_id = public.auth_org() and not public.auth_is_client());

drop policy if exists project_members_write on public.project_members;
create policy project_members_write on public.project_members
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','manager'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','manager'), false));


-- ---------------------------------------------------------------------
--  PART 3 - Backfill from the two columns that already exist
-- ---------------------------------------------------------------------
--  Derived, not invented. Every row here restates something the database
--  already said, in a shape that can hold more than one person.
--
--  ON CONFLICT DO NOTHING throughout, so this file is safe to run twice and so
--  a manager who is also the assigned developer keeps the stronger row (the
--  manager insert runs first).

-- 3a) The project manager.
insert into public.project_members
  (organization_id, project_id, user_id, user_type, project_role)
select p.organization_id, p.id, p.manager_id, 'developer', 'manager'
from public.projects p
where p.manager_id is not null
  and p.organization_id is not null
on conflict (project_id, user_id) do nothing;

-- 3b) The assigned developer. `assigned_to` references developers(id), and a
--     membership's user_id for a developer IS that developers row id, so the
--     two are the same value space.
insert into public.project_members
  (organization_id, project_id, user_id, user_type, project_role)
select p.organization_id, p.id, p.assigned_to, 'developer', 'developer'
from public.projects p
where p.assigned_to is not null
  and p.organization_id is not null
on conflict (project_id, user_id) do nothing;

-- 3c) Anyone who already holds a task on the project. They are demonstrably on
--     it; leaving them out would mean project scoping immediately took access
--     away from people doing the work, which is how a security improvement
--     gets reverted in a hurry.
insert into public.project_members
  (organization_id, project_id, user_id, user_type, project_role)
select distinct t.organization_id, t.project_id, t.developer_id, 'developer', 'developer'
from public.developer_tasks t
where t.developer_id is not null
  and t.project_id is not null
  and t.organization_id is not null
on conflict (project_id, user_id) do nothing;


-- ---------------------------------------------------------------------
--  PART 4 - Keep manager_id and the manager row in step
-- ---------------------------------------------------------------------
--  Without this, the two DO become a pair of truths that disagree: someone
--  reassigns a project through /api/projects/[id]/manager, manager_id moves,
--  and project_members still names the old manager as manager.
--
--  The trigger demotes the previous manager to 'developer' rather than deleting
--  them: a person who managed a project usually still knows it and is often
--  still working on it, and silently removing their access on a reassignment is
--  a surprise. Removal is a deliberate act, not a side effect.

create or replace function public.projects_sync_manager_member()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.manager_id is not distinct from old.manager_id then
    return new;
  end if;

  -- Demote whoever held 'manager' on this project and is not the new manager.
  update public.project_members
     set project_role = 'developer', updated_at = now()
   where project_id = new.id
     and project_role = 'manager'
     and user_id is distinct from new.manager_id;

  if new.manager_id is not null and new.organization_id is not null then
    insert into public.project_members
      (organization_id, project_id, user_id, user_type, project_role)
    values (new.organization_id, new.id, new.manager_id, 'developer', 'manager')
    on conflict (project_id, user_id)
      do update set project_role = 'manager', updated_at = now();
  end if;

  return new;
end
$$;

-- SECURITY DEFINER here is correct and is the OPPOSITE of the rule in 070.
-- 070's guard had to see the real current_user to decide whether to exempt it.
-- This one only propagates a change that has already been authorised on
-- `projects`, and it must be able to write project_members even when the caller
-- cannot - a route that may reassign a manager must not fail because the actor
-- lacks a direct write on this table.

drop trigger if exists trg_projects_sync_manager_member on public.projects;
create trigger trg_projects_sync_manager_member
  after update of manager_id on public.projects
  for each row execute function public.projects_sync_manager_member();


-- ---------------------------------------------------------------------
--  VERIFY (read-only)
-- ---------------------------------------------------------------------
--  select project_role, count(*) from public.project_members group by 1 order by 1;
--
--  Nobody on a project in an organization they do not belong to - expect 0:
--  select count(*) from public.project_members pm
--    join public.projects p on p.id = pm.project_id
--   where p.organization_id <> pm.organization_id;
--
--  At most one manager per project - expect 0 rows:
--  select project_id, count(*) from public.project_members
--   where project_role = 'manager' group by 1 having count(*) > 1;
