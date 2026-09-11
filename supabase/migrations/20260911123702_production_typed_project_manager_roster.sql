begin;
-- A project roster identity is the typed profile, not an interchangeable UUID.
alter table public.project_members drop constraint project_members_unique;
alter table public.project_members add constraint project_members_unique unique(project_id,user_id,user_type);
create or replace function public.projects_sync_manager_member()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_type text;
begin
 target_type:=coalesce(new.manager_type,public.project_unique_identity_type(new.organization_id,new.manager_id::text));
 if new.manager_id is not null and not exists(select 1 from public.memberships m
  where m.organization_id=new.organization_id and m.user_id=new.manager_id and m.user_type=target_type
   and m.status='active' and m.role in ('owner','admin','manager','team_lead')) then
  raise exception 'Project manager requires an active, unambiguous typed manager membership' using errcode='23514';
 end if;
 -- Retain former managers as collaborators, including a different profile
 -- sharing the newly assigned manager UUID. Do not overwrite identity/allocation.
 update public.project_members set project_role='developer',updated_at=now()
 where project_id=new.id and organization_id=new.organization_id and project_role='manager'
  and (new.manager_id is null or (user_id,user_type) is distinct from (new.manager_id,target_type));
 if new.manager_id is not null then
  insert into public.project_members(organization_id,project_id,user_id,user_type,project_role)
  values(new.organization_id,new.id,new.manager_id,target_type,'manager')
  on conflict(project_id,user_id,user_type) do update set project_role='manager',updated_at=now();
 end if;
 return new;
end $$;
revoke all on function public.projects_sync_manager_member() from public,anon,authenticated;
drop trigger if exists trg_projects_sync_manager_member on public.projects;
create trigger trg_projects_sync_manager_member after insert or update of manager_id,manager_type on public.projects
 for each row execute function public.projects_sync_manager_member();
-- Enforce the authoritative manager pointer even for service writes. Lock the
-- parent to serialize reassignment with roster mutation; conflicting lock orders
-- can abort/retry rather than permitting a stale authorization check to commit.
create or replace function public.guard_project_manager_roster()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.projects%rowtype; manager_profile text; target_project uuid;
begin
 if tg_op='UPDATE' and (new.organization_id,new.project_id,new.user_id,new.user_type) is distinct from (old.organization_id,old.project_id,old.user_id,old.user_type) then
  raise exception 'Project roster identity is immutable' using errcode='23514';
 end if;
 if tg_op='DELETE' then target_project:=old.project_id; else target_project:=new.project_id; end if;
 select * into p from public.projects where id=target_project for update;
 if not found then
  if tg_op='DELETE' then return old; end if;
  raise exception 'Project is required for roster writes' using errcode='23514';
 end if;
 manager_profile:=coalesce(p.manager_type,public.project_unique_identity_type(p.organization_id,p.manager_id::text));
 if tg_op in ('DELETE','UPDATE') then
  if old.organization_id=p.organization_id and old.user_id=p.manager_id and old.user_type=manager_profile then
   if tg_op='DELETE' then raise exception 'Reassign the project manager before removing this member' using errcode='23514'; end if;
   if new.project_role<>'manager' or (new.organization_id,new.project_id,new.user_id,new.user_type)
    is distinct from (old.organization_id,old.project_id,old.user_id,old.user_type) then
    raise exception 'Reassign the project manager before changing this membership' using errcode='23514';
   end if;
  end if;
 end if;
 if tg_op<>'DELETE' and new.project_role='manager' then
  if tg_op='INSERT' or (new.project_role,new.organization_id,new.project_id,new.user_id,new.user_type)
   is distinct from (old.project_role,old.organization_id,old.project_id,old.user_id,old.user_type) then
   if not coalesce(new.organization_id=p.organization_id and new.user_id=p.manager_id and new.user_type=manager_profile,false) then
    raise exception 'Assign the project manager through the project workflow' using errcode='23514';
   end if;
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.guard_project_manager_roster() from public,anon,authenticated;
create trigger project_manager_roster before insert or update or delete on public.project_members
 for each row execute function public.guard_project_manager_roster();
-- Repair authoritative, currently eligible historical manager mappings only.
-- Ambiguous/inactive legacy assignments require explicit reassignment.
-- Only the historical metadata backfill bypasses the delivery billing trigger.
-- The table lock prevents concurrent writes; DDL and backfill roll back together.
-- No runtime role, JWT claim, or session setting gains a billing bypass.
lock table public.projects in access exclusive mode;
do $backfill$
declare previous_state "char";
begin
 select tgenabled into previous_state from pg_trigger
 where tgrelid='public.projects'::regclass and tgname='delivery_write_lock' and not tgisinternal;
 if previous_state is not null then
  alter table public.projects disable trigger delivery_write_lock;
 end if;
update public.projects p set manager_type=coalesce(p.manager_type,public.project_unique_identity_type(p.organization_id,p.manager_id::text))
where p.manager_id is not null and exists(select 1 from public.memberships m
 where m.organization_id=p.organization_id and m.user_id=p.manager_id
  and m.user_type=coalesce(p.manager_type,public.project_unique_identity_type(p.organization_id,p.manager_id::text))
  and m.status='active' and m.role in ('owner','admin','manager','team_lead'));
 if previous_state in ('O','A','R') then
  execute 'alter table public.projects enable ' || case previous_state
   when 'A' then 'always ' when 'R' then 'replica ' else '' end || 'trigger delivery_write_lock';
 end if;
end $backfill$;
commit;
