begin;
create or replace function public.auth_agile_container_write(p_org uuid,p_project uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
 select p_org=public.auth_org() and public.auth_org_unlocked() and public.auth_task_capability('task.manage')
 and exists(select 1 from public.memberships m where m.organization_id=p_org and m.user_id=public.auth_app_user_id()
  and m.user_type=auth.jwt()->'app_metadata'->>'user_type' and m.user_type in ('admin','developer') and m.status='active')
 and (p_project is null or exists(select 1 from public.projects p where p.id=p_project and p.organization_id=p_org));
$$;
revoke all on function public.auth_agile_container_write(uuid,uuid) from public,anon;
grant execute on function public.auth_agile_container_write(uuid,uuid) to authenticated;
do $$ declare tbl text; begin
 foreach tbl in array array['sprints','epics'] loop
  execute format('create policy agile_write_insert on public.%I as restrictive for insert to authenticated with check(public.auth_agile_container_write(organization_id,project_id))',tbl);
  execute format('create policy agile_write_update on public.%I as restrictive for update to authenticated using(public.auth_agile_container_write(organization_id,project_id)) with check(public.auth_agile_container_write(organization_id,project_id))',tbl);
  execute format('create policy agile_write_delete on public.%I as restrictive for delete to authenticated using(public.auth_agile_container_write(organization_id,project_id))',tbl);
 end loop;
end $$;
-- Changed-field validation lets legacy invalid rows receive unrelated edits;
-- new data and edits to invalid fields must satisfy the actual UI contract.
create or replace function public.guard_agile_container_content()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' then
  if new.project_id is not null and not exists(select 1 from public.projects p where p.id=new.project_id and p.organization_id=new.organization_id) then
   raise exception 'Sprint/epic project must be accessible in the same organization' using errcode='23514'; end if;
 end if;
 if tg_op='INSERT' or new.name is distinct from old.name then
  if new.name is null or btrim(new.name)='' then raise exception 'Sprint/epic name is required' using errcode='23514'; end if;
  new.name:=btrim(new.name);
 end if;
 if tg_op='INSERT' or new.status is distinct from old.status then
  if new.status is null or (tg_table_name='sprints' and new.status not in ('planned','active','completed'))
   or (tg_table_name='epics' and new.status not in ('open','in_progress','done')) then
   raise exception 'Invalid sprint/epic status' using errcode='23514'; end if;
 end if;
 if tg_table_name='sprints' then
  if tg_op='INSERT' or (new.start_date,new.end_date) is distinct from (old.start_date,old.end_date) then
   if new.start_date is not null and new.end_date is not null and new.end_date<new.start_date then
    raise exception 'Sprint end date cannot precede start date' using errcode='23514'; end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_agile_container_content() from public,anon,authenticated;
create trigger agile_container_content before insert or update on public.sprints for each row execute function public.guard_agile_container_content();
create trigger agile_container_content before insert or update on public.epics for each row execute function public.guard_agile_container_content();
commit;
