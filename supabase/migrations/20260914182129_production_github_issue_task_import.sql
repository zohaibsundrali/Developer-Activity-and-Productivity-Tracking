begin;
create function public.can_import_github_issue(p_project uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog,public as $$
 select coalesce(public.can_read_project_github(p_project),false)
 and coalesce(public.auth_task_capability('task.manage'),false)
 and coalesce(public.auth_task_access(public.auth_org(),p_project,null,'feature',false,'read'),false);
$$;
revoke all on function public.can_import_github_issue(uuid) from public,anon;
grant execute on function public.can_import_github_issue(uuid) to authenticated;
create table public.github_issue_task_imports (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 repository_id bigint not null check(repository_id between 1 and 9007199254740991),
 issue_id bigint not null check(issue_id between 1 and 9007199254740991), issue_number bigint not null check(issue_number between 1 and 9007199254740991),
 -- Reservation and task insert commit together; a direct reservation alone fails
 -- its deferred FK. Deletion retains a tombstone so re-import cannot resurrect it.
 task_id uuid unique references public.developer_tasks(id) on delete set null deferrable initially deferred,
 original_task_id uuid not null unique, source jsonb not null,
 start_date date not null,end_date date not null check(end_date>=start_date),
 imported_by uuid not null, imported_by_type text not null check(imported_by_type in ('admin','developer')),
 imported_at timestamptz not null default clock_timestamp(),
 unique(project_id,repository_id,issue_id),unique(project_id,repository_id,issue_number)
);
create index github_issue_task_imports_org on public.github_issue_task_imports(organization_id,project_id);
alter table public.github_issue_task_imports enable row level security;
revoke all on public.github_issue_task_imports from public,anon,authenticated;
grant select on public.github_issue_task_imports to authenticated;
create policy github_issue_task_imports_read on public.github_issue_task_imports for select to authenticated using(
 organization_id=(select public.auth_org()) and public.can_import_github_issue(project_id));
create or replace function public.project_github_context(p_project uuid) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if not coalesce(public.can_read_project_github(p_project),false) then raise exception 'GITHUB_PROJECT_FORBIDDEN' using errcode='42501';end if;
 select to_jsonb(g) into result from public.project_github_links g where g.project_id=p_project and g.organization_id=public.auth_org();
 return jsonb_build_object('project_id',p_project,'organization_id',public.auth_org(),'link',result,
 'can_manage',coalesce(public.auth_project_staffing(p_project,'project.manage_members'),false),'can_import',public.can_import_github_issue(p_project));
end$$;
create function app_private.reserve_github_issue_task(p_project uuid,p_version integer,p_issue jsonb,p_start date,p_end date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); actor uuid:=public.auth_app_user_id(); kind text:=auth.jwt()->'app_metadata'->>'user_type'; link public.project_github_links%rowtype; saved public.github_issue_task_imports%rowtype; project public.projects%rowtype; task uuid:=gen_random_uuid();
begin
 if auth.uid() is null or org is null or actor is null or kind is null or kind not in ('admin','developer') or not public.can_import_github_issue(p_project) then raise exception 'GITHUB_IMPORT_FORBIDDEN' using errcode='42501';end if;
 if p_version is null or p_version<1 or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<p_start
 or jsonb_typeof(p_issue) is distinct from 'object' or octet_length(p_issue::text)>100000
 or jsonb_typeof(p_issue->'repository_id') is distinct from 'number' or jsonb_typeof(p_issue->'id') is distinct from 'number' or jsonb_typeof(p_issue->'number') is distinct from 'number'
 or (p_issue->>'repository_id')!~'^[1-9][0-9]{0,15}$' or (p_issue->>'id')!~'^[1-9][0-9]{0,15}$' or (p_issue->>'number')!~'^[1-9][0-9]{0,15}$'
 or (p_issue->>'repository_id')::bigint>9007199254740991 or (p_issue->>'id')::bigint>9007199254740991 or (p_issue->>'number')::bigint>9007199254740991
 or jsonb_typeof(p_issue->'title') is distinct from 'string' or length(btrim(p_issue->>'title')) not between 1 and 255
 or jsonb_typeof(p_issue->'body') is distinct from 'string' or length(p_issue->>'body')>60000
 or jsonb_typeof(p_issue->'state') is distinct from 'string' or p_issue->>'state' not in ('open','closed')
 or jsonb_typeof(p_issue->'updated_at') is distinct from 'string' or not isfinite((p_issue->>'updated_at')::timestamptz)
 or jsonb_typeof(p_issue->'url') is distinct from 'string'
 or exists(select 1 from jsonb_object_keys(p_issue) k where k not in ('repository_id','id','number','title','body','state','updated_at','url')) then raise exception 'GITHUB_IMPORT_INVALID' using errcode='22023';end if;
 perform app_private.lock_quota(org);
 if public.auth_org() is distinct from org or not public.can_import_github_issue(p_project) then raise exception 'GITHUB_IMPORT_FORBIDDEN' using errcode='42501';end if;
 if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED';end if;
 select * into project from public.projects where id=p_project and organization_id=org for update;
 if not found or coalesce(project.archived,false) or project.status='closed' then raise exception 'GITHUB_IMPORT_PROJECT_CLOSED' using errcode='55000';end if;
 select * into link from public.project_github_links where project_id=p_project and organization_id=org for update;
 if not found or link.version<>p_version or link.repository_id is distinct from (p_issue->>'repository_id')::bigint then raise exception 'GITHUB_LINK_STALE' using errcode='40001';end if;
 if lower(p_issue->>'url') is distinct from lower('https://github.com/'||link.owner||'/'||link.repository||'/issues/'||(p_issue->>'number')) then raise exception 'GITHUB_IMPORT_INVALID' using errcode='22023';end if;
 select * into saved from public.github_issue_task_imports where project_id=p_project and repository_id=link.repository_id and (issue_id=(p_issue->>'id')::bigint or issue_number=(p_issue->>'number')::bigint) for update;
 if found then
 if saved.issue_id<>(p_issue->>'id')::bigint or saved.issue_number<>(p_issue->>'number')::bigint then raise exception 'GITHUB_IMPORT_IDENTITY_CHANGED' using errcode='40001';end if;
 return jsonb_build_object('import',to_jsonb(saved),'unchanged',true);
 end if;
 insert into public.github_issue_task_imports(organization_id,project_id,repository_id,issue_id,issue_number,task_id,original_task_id,source,start_date,end_date,imported_by,imported_by_type)
 values(org,p_project,link.repository_id,(p_issue->>'id')::bigint,(p_issue->>'number')::bigint,task,task,p_issue,p_start,p_end,actor,kind) returning * into saved;
 return jsonb_build_object('import',to_jsonb(saved),'unchanged',false);
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then raise exception 'GITHUB_IMPORT_INVALID' using errcode='22023';
end$$;
revoke all on function app_private.reserve_github_issue_task(uuid,integer,jsonb,date,date) from public,anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.reserve_github_issue_task(uuid,integer,jsonb,date,date) to authenticated;
create function public.import_github_issue_task(p_project uuid,p_version integer,p_issue jsonb,p_start date,p_end date) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,app_private as $$
declare reservation jsonb; mapping jsonb; task public.developer_tasks%rowtype;
begin
 reservation:=app_private.reserve_github_issue_task(p_project,p_version,p_issue,p_start,p_end);mapping:=reservation->'import';
 if not (reservation->>'unchanged')::boolean then
 -- Invoker insertion preserves all existing task RLS, quota, billing, review,
 -- relationship and notification guards. No assignment or approval is inferred.
 insert into public.developer_tasks(id,organization_id,project_id,developer_id,task_title,task_description,task_type,status,priority,client_visible,start_date,end_date,reported_by)
 values((mapping->>'task_id')::uuid,public.auth_org(),p_project,null,p_issue->>'title',(p_issue->>'body')||E'\n\nGitHub issue: '||(p_issue->>'url'),'feature','pending','medium',false,p_start,p_end,public.auth_app_user_id()) returning * into task;
 elsif mapping->>'task_id' is not null then
 select * into task from public.developer_tasks where id=(mapping->>'task_id')::uuid and organization_id=public.auth_org() and project_id=p_project;
 if not found then raise exception 'GITHUB_IMPORT_FORBIDDEN' using errcode='42501';end if;
 end if;
 return reservation||jsonb_build_object('task',case when task.id is null then null else jsonb_build_object('id',task.id,'project_id',task.project_id,'organization_id',task.organization_id,'title',task.task_title,'status',task.status,'start_date',task.start_date,'end_date',task.end_date) end);
end$$;
revoke all on function public.import_github_issue_task(uuid,integer,jsonb,date,date) from public,anon;
grant execute on function public.import_github_issue_task(uuid,integer,jsonb,date,date) to authenticated;
commit;
