begin;
-- Milestones are planning records, using the same effective task.manage,
-- active typed membership, readable project and billing gate as sprints/epics.
create policy milestone_planning_insert on public.milestones as restrictive for insert to authenticated
 with check(project_id is not null and public.auth_agile_container_write(organization_id,project_id));
create policy milestone_planning_update on public.milestones as restrictive for update to authenticated
 using(public.auth_agile_container_write(organization_id,project_id))
 with check(project_id is not null and public.auth_agile_container_write(organization_id,project_id));
create policy milestone_planning_delete on public.milestones as restrictive for delete to authenticated
 using(public.auth_agile_container_write(organization_id,project_id));
create function public.guard_milestone_content() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
 if tg_op='UPDATE' and row(new.id,new.organization_id,new.project_id) is distinct from row(old.id,old.organization_id,old.project_id) then
  raise exception 'Milestone identity and project scope are immutable' using errcode='23514'; end if;
 if tg_op='INSERT' and not exists(select 1 from public.projects p where p.id=new.project_id and p.organization_id=new.organization_id) then
  raise exception 'Milestone project must belong to its organization' using errcode='23514'; end if;
 if tg_op='INSERT' or new.title is distinct from old.title then
  new.title:=btrim(new.title);
  if new.title is null or new.title='' then raise exception 'Milestone title is required' using errcode='23514'; end if;
 end if;
 if tg_op='INSERT' or new.status is distinct from old.status then
  if new.status is null or new.status not in ('pending','in_progress','completed') then raise exception 'Invalid milestone status' using errcode='23514'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_milestone_content() from public,anon,authenticated;
create trigger milestone_content before insert or update on public.milestones for each row execute function public.guard_milestone_content();
commit;
