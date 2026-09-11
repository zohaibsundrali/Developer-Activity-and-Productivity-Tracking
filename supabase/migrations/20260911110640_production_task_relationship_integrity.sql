begin;
-- NOT VALID retains legacy rows for explicit review; new references and deletes
-- are enforced immediately. Detach related work before deleting its container.
alter table public.developer_tasks
 add constraint task_parent_reference foreign key(parent_task_id) references public.developer_tasks(id) on delete restrict not valid,
 add constraint task_sprint_reference foreign key(sprint_id) references public.sprints(id) on delete restrict not valid,
 add constraint task_epic_reference foreign key(epic_id) references public.epics(id) on delete restrict not valid,
 add constraint task_parent_not_self check(parent_task_id is distinct from id) not valid;
create index if not exists idx_dev_tasks_epic on public.developer_tasks(epic_id);

create or replace function public.guard_task_relationships() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare check_parent boolean; check_sprint boolean; check_epic boolean; target record;
begin
 if tg_op='INSERT' then
   check_parent:=true; check_sprint:=true; check_epic:=true;
 else
   check_parent:=new.parent_task_id is distinct from old.parent_task_id or new.project_id is distinct from old.project_id or new.organization_id is distinct from old.organization_id;
   check_sprint:=new.sprint_id is distinct from old.sprint_id or new.project_id is distinct from old.project_id or new.organization_id is distinct from old.organization_id;
   check_epic:=new.epic_id is distinct from old.epic_id or new.project_id is distinct from old.project_id or new.organization_id is distinct from old.organization_id;
 end if;
 if check_parent and new.parent_task_id is not null then
   select id,project_id,organization_id into target from public.developer_tasks where id=new.parent_task_id for key share;
   if not found or target.organization_id is distinct from new.organization_id or target.project_id is distinct from new.project_id or target.id=new.id then
     raise exception 'Task parent must be an accessible task in the same project' using errcode='23514';
   end if;
 end if;
 if check_sprint and new.sprint_id is not null then
   -- SHARE also serializes against closing a sprint, not just its deletion.
   select id,project_id,organization_id,status into target from public.sprints where id=new.sprint_id for share;
   if not found or target.organization_id is distinct from new.organization_id or (target.project_id is not null and target.project_id is distinct from new.project_id) then
     raise exception 'Task sprint must be accessible in this organization and project' using errcode='23514';
   end if;
   if target.status='completed' then
     raise exception 'Cannot add work to a completed sprint' using errcode='23514';
   end if;
 end if;
 if check_epic and new.epic_id is not null then
   select id,project_id,organization_id into target from public.epics where id=new.epic_id for key share;
   if not found or target.organization_id is distinct from new.organization_id or (target.project_id is not null and target.project_id is distinct from new.project_id) then
     raise exception 'Task epic must be accessible in this organization and project' using errcode='23514';
   end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_task_relationships() from public;
create trigger task_relationship_integrity before insert or update on public.developer_tasks
for each row execute function public.guard_task_relationships();

-- Moving a sprint/epic between projects would invalidate its existing task
-- references. These are container identities, not editable presentation fields.
create or replace function public.guard_agile_container_identity() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id or new.project_id is distinct from old.project_id then
   raise exception 'Sprint and epic identities cannot be reassigned' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function public.guard_agile_container_identity() from public;
create trigger agile_container_identity before update on public.sprints for each row execute function public.guard_agile_container_identity();
create trigger agile_container_identity before update on public.epics for each row execute function public.guard_agile_container_identity();
-- The trigger returns no graph data. Traverse ancestors with owner visibility
-- so a hidden ancestor cannot truncate cycle detection. The physical quota lock
-- serializes same-organization graph edits and rejects stale repeatable reads.
create or replace function public.guard_task_parent_cycle() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare cyclic boolean;
begin
 if new.parent_task_id is null then return new; end if;
 if tg_op='UPDATE' and new.parent_task_id is not distinct from old.parent_task_id then return new; end if;
 if current_setting('role',true)='authenticated' and new.organization_id is distinct from public.auth_org() then
   raise exception 'Task organization is not authorized' using errcode='42501';
 end if;
 perform app_private.lock_quota(new.organization_id);
 with recursive ancestors(id,parent_task_id,path,cycle) as (
   select t.id,t.parent_task_id,array[t.id],false from public.developer_tasks t
    where t.id=new.parent_task_id and t.organization_id=new.organization_id and t.project_id=new.project_id
   union all
   select t.id,t.parent_task_id,a.path||t.id,t.id=any(a.path)
    from ancestors a join public.developer_tasks t on t.id=a.parent_task_id
    where not a.cycle and t.organization_id=new.organization_id and t.project_id=new.project_id
 ) select coalesce(bool_or(id=new.id or cycle),false) into cyclic from ancestors;
 if cyclic then raise exception 'Task parent hierarchy cannot contain cycles' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function public.guard_task_parent_cycle() from public;
create trigger task_parent_cycle before insert or update on public.developer_tasks
for each row execute function public.guard_task_parent_cycle();
commit;
