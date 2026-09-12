-- Attribution is historical: deletion of work must not delete recorded time.
begin;
alter table public.productivity_sessions add column project_id uuid, add column task_id uuid;
alter table public.productivity_sessions add constraint tracking_task_requires_project check(task_id is null or project_id is not null);
create index productivity_sessions_work_context on public.productivity_sessions(organization_id,project_id) where project_id is not null;

create function public.auth_tracking_work_project(p_project uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog,public as $$
 select public.auth_tracker_session() and auth.jwt()->'app_metadata'->>'user_type'='developer'
 and exists(select 1 from public.projects p where p.id=p_project and p.organization_id=public.auth_org()
  and p.status='active' and not coalesce(p.archived,false) and not coalesce(p.is_template,false)
  and (exists(select 1 from public.project_members m where m.project_id=p.id and m.organization_id=p.organization_id
    and m.user_id=public.auth_app_user_id() and m.user_type='developer')
    or exists(select 1 from public.developer_tasks t where t.project_id=p.id and t.organization_id=p.organization_id
    and t.developer_id=public.auth_app_user_id() and t.status in ('pending','in_progress','rejected')
    and public.auth_task_access(t.organization_id,t.project_id,t.developer_id,t.task_type,t.client_visible,'read'))))
$$;
create function public.get_tracking_work_options() returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare org uuid:=public.auth_org(); result jsonb;
begin
 if org is null or auth.uid() is null or auth.jwt()->'app_metadata'->>'user_type' is distinct from 'developer'
  or not coalesce(public.auth_tracker_session(),false) then raise exception 'TRACKING_DEVICE_REQUIRED' using errcode='42501'; end if;
 with selectable as (select p.id,p.name from public.projects p where public.auth_tracking_work_project(p.id) order by p.name,p.id limit 1001)
 select jsonb_build_object('organization_id',org,
  'projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.name,p.id) from selectable p),'[]'::jsonb),
  'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.task_title,'project_id',t.project_id) order by t.task_title,t.id)
   from (select t.* from public.developer_tasks t join selectable p on p.id=t.project_id where t.organization_id=org
    and t.developer_id=public.auth_app_user_id() and t.status in ('pending','in_progress','rejected')
    and public.auth_task_access(t.organization_id,t.project_id,t.developer_id,t.task_type,t.client_visible,'read') order by t.task_title,t.id limit 10001) t),'[]'::jsonb)) into result;
 if jsonb_array_length(result->'projects')>1000 or jsonb_array_length(result->'tasks')>10000 then
  raise exception 'TRACKING_OPTIONS_TOO_LARGE' using errcode='54000'; end if;
 return result;
end $$;
create function public.guard_tracking_work_context() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare previous public.productivity_sessions%rowtype;
begin
 if tg_op='UPDATE' then
  if (new.project_id,new.task_id) is distinct from (old.project_id,old.task_id) then
   raise exception 'TRACKING_CONTEXT_IMMUTABLE' using errcode='42501'; end if;
  return new;
 end if;
 -- Before-insert also executes for checkpoint UPSERTs. Only a visible own
 -- session with exactly the original attribution may reuse historical work.
 select * into previous from public.productivity_sessions where session_id=new.session_id;
 if found and public.auth_tracker_row(to_jsonb(new)) and public.auth_tracker_row(to_jsonb(previous)) then
  if (new.project_id,new.task_id) is distinct from (previous.project_id,previous.task_id) then
   raise exception 'TRACKING_CONTEXT_IMMUTABLE' using errcode='42501'; end if;
  return new;
 end if;
 if new.project_id is null and new.task_id is null then return new; end if;
 if not coalesce(public.auth_tracker_row(to_jsonb(new)),false) or new.project_id is null
  or not coalesce(public.auth_tracking_work_project(new.project_id),false) then
  raise exception 'TRACKING_PROJECT_FORBIDDEN' using errcode='42501'; end if;
 if new.task_id is not null and not exists(select 1 from public.developer_tasks t
  where t.id=new.task_id and t.organization_id=new.organization_id and t.project_id=new.project_id
   and t.developer_id=public.auth_app_user_id() and t.status in ('pending','in_progress','rejected')
   and public.auth_task_access(t.organization_id,t.project_id,t.developer_id,t.task_type,t.client_visible,'read')) then
  raise exception 'TRACKING_TASK_FORBIDDEN' using errcode='42501'; end if;
 return new;
end $$;
create trigger tracking_work_context before insert or update on public.productivity_sessions
 for each row execute function public.guard_tracking_work_context();
revoke all on function public.auth_tracking_work_project(uuid),public.get_tracking_work_options(),public.guard_tracking_work_context() from public,anon;
grant execute on function public.auth_tracking_work_project(uuid),public.get_tracking_work_options() to authenticated;
commit;
