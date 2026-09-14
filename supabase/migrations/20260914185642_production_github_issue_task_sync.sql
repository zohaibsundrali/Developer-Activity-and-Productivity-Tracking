begin;
create table public.github_issue_task_syncs (
 id uuid primary key, import_id uuid not null references public.github_issue_task_imports(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 task_id uuid references public.developer_tasks(id) on delete set null,
 revision integer not null check(revision>0), link_version integer not null,
 expected text not null check(expected~'^[a-f0-9]{32}$'), source jsonb not null,
 title_choice text not null check(title_choice in ('auto','local','github')),
 description_choice text not null check(description_choice in ('auto','local','github')),
 previous jsonb not null, applied jsonb not null, actor_id uuid not null,
 actor_type text not null check(actor_type in ('admin','developer')), created_at timestamptz not null,
 unique(import_id,revision)
);
create index github_issue_task_syncs_org on public.github_issue_task_syncs(organization_id,project_id);
create index github_issue_task_syncs_project on public.github_issue_task_syncs(project_id);
create index github_issue_task_syncs_task on public.github_issue_task_syncs(task_id);
alter table public.github_issue_task_syncs enable row level security;
revoke all on public.github_issue_task_syncs from public,anon,authenticated;
grant select,insert on public.github_issue_task_syncs to authenticated;
create policy github_issue_task_syncs_read on public.github_issue_task_syncs for select to authenticated using(organization_id=(select public.auth_org()) and public.can_import_github_issue(project_id));
create policy github_issue_task_syncs_insert on public.github_issue_task_syncs for insert to authenticated with check(organization_id=(select public.auth_org()) and public.can_import_github_issue(project_id) and actor_id=(select public.auth_app_user_id()) and actor_type=(select auth.jwt()->'app_metadata'->>'user_type'));
create function public.github_issue_sync_context(p_project uuid,p_number bigint) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare snapshot jsonb;
begin
 if not coalesce(public.can_import_github_issue(p_project),false) then raise exception 'GITHUB_SYNC_FORBIDDEN' using errcode='42501';end if;
 select jsonb_build_object('import_id',i.id,'organization_id',i.organization_id,'project_id',i.project_id,'repository_id',i.repository_id,'issue_id',i.issue_id,'number',i.issue_number,
 'link_version',l.version,'revision',coalesce(last_sync.revision,0),'baseline',coalesce(last_sync.source,i.source),
 'task',jsonb_build_object('id',t.id,'title',t.task_title,'description',t.task_description,'status',t.status)) into snapshot
 from public.github_issue_task_imports i join public.project_github_links l on l.project_id=i.project_id and l.organization_id=i.organization_id and l.repository_id=i.repository_id
 join public.developer_tasks t on t.id=i.task_id and t.project_id=i.project_id and t.organization_id=i.organization_id
 left join lateral (select revision,source from public.github_issue_task_syncs e where e.import_id=i.id order by revision desc limit 1) last_sync on true
 where i.organization_id=public.auth_org() and i.project_id=p_project and i.issue_number=p_number;
 if snapshot is null then raise exception 'GITHUB_SYNC_NOT_FOUND' using errcode='P0002';end if;
 return jsonb_build_object('snapshot',snapshot,'fingerprint',md5(snapshot::text));
end$$;
revoke all on function public.github_issue_sync_context(uuid,bigint) from public,anon;
grant execute on function public.github_issue_sync_context(uuid,bigint) to authenticated;
create function app_private.guard_github_issue_sync() returns trigger language plpgsql security invoker set search_path=pg_catalog,public,app_private as $$
declare mapping public.github_issue_task_imports%rowtype; checked jsonb; context jsonb; snapshot jsonb; field text; old_remote text; incoming text; local_value text; choice text; result jsonb:='{}'::jsonb;
begin
 select * into mapping from public.github_issue_task_imports where id=new.import_id and organization_id=public.auth_org();
 if not found or not coalesce(public.can_import_github_issue(mapping.project_id),false) then raise exception 'GITHUB_SYNC_FORBIDDEN' using errcode='42501';end if;
 if new.id is null or new.expected is null or new.expected!~'^[a-f0-9]{32}$' or new.title_choice is null or new.title_choice not in ('auto','local','github') or new.description_choice is null or new.description_choice not in ('auto','local','github') then raise exception 'GITHUB_SYNC_INVALID' using errcode='22023';end if;
 -- Reuse the import's source validation, current link check, active-project and
 -- billing gates. This must return the existing mapping, never a new import.
 checked:=app_private.reserve_github_issue_task(mapping.project_id,new.link_version,new.source,mapping.start_date,mapping.end_date);
 if checked->'import'->>'id'<>mapping.id::text or checked->>'unchanged'<>'true' then raise exception 'GITHUB_SYNC_STALE' using errcode='40001';end if;
 perform 1 from public.developer_tasks where id=mapping.task_id and organization_id=mapping.organization_id and project_id=mapping.project_id for update;
 if not found then raise exception 'GITHUB_SYNC_NOT_FOUND' using errcode='P0002';end if;
 context:=public.github_issue_sync_context(mapping.project_id,mapping.issue_number);snapshot:=context->'snapshot';
 if context->>'fingerprint'<>new.expected or (snapshot->>'revision')::integer>=2147483647 then raise exception 'GITHUB_SYNC_STALE' using errcode='40001';end if;
 foreach field in array array['title','description'] loop
  old_remote:=case when field='title' then snapshot->'baseline'->>'title' else (snapshot->'baseline'->>'body')||E'\n\nGitHub issue: '||(snapshot->'baseline'->>'url') end;
  incoming:=case when field='title' then new.source->>'title' else (new.source->>'body')||E'\n\nGitHub issue: '||(new.source->>'url') end;
  local_value:=snapshot->'task'->>field;
  choice:=case when field='title' then new.title_choice else new.description_choice end;
  if choice='auto' and local_value is distinct from old_remote and incoming is distinct from old_remote and local_value is distinct from incoming then raise exception 'GITHUB_SYNC_CONFLICT' using errcode='40001';end if;
  result:=result||jsonb_build_object(field,case when choice='github' or (choice='auto' and local_value is not distinct from old_remote) then incoming else local_value end);
 end loop;
 new.organization_id:=mapping.organization_id;new.project_id:=mapping.project_id;new.task_id:=mapping.task_id;new.revision:=(snapshot->>'revision')::integer+1;
 new.previous:=snapshot;new.applied:=result;new.actor_id:=public.auth_app_user_id();new.actor_type:=auth.jwt()->'app_metadata'->>'user_type';new.created_at:=clock_timestamp();
 return new;
end$$;
revoke all on function app_private.guard_github_issue_sync() from public,anon,authenticated;
create trigger guard_github_issue_sync before insert on public.github_issue_task_syncs for each row execute function app_private.guard_github_issue_sync();
-- An audit event cannot claim an update that never committed. The caller's task
-- UPDATE still runs as invoker; RLS/trigger failure rolls back this event too.
create function app_private.check_github_issue_sync_applied() returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
begin
 if not exists(select 1 from public.developer_tasks where id=new.task_id and organization_id=new.organization_id and project_id=new.project_id
 and task_title is not distinct from new.applied->>'title' and task_description is not distinct from new.applied->>'description') then raise exception 'GITHUB_SYNC_NOT_APPLIED' using errcode='23514';end if;
 return null;
end$$;
revoke all on function app_private.check_github_issue_sync_applied() from public,anon,authenticated;
create constraint trigger github_issue_sync_applied after insert on public.github_issue_task_syncs deferrable initially deferred for each row execute function app_private.check_github_issue_sync_applied();
create function public.sync_github_issue_task(p_project uuid,p_id uuid,p_import uuid,p_version integer,p_expected text,p_source jsonb,p_title text,p_description text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,app_private as $$
declare saved public.github_issue_task_syncs%rowtype; affected integer;
begin
 if not coalesce(public.can_import_github_issue(p_project),false) then raise exception 'GITHUB_SYNC_FORBIDDEN' using errcode='42501';end if;
 perform app_private.lock_quota(public.auth_org());
 select * into saved from public.github_issue_task_syncs where id=p_id;
 if found then
 if row(saved.project_id,saved.import_id,saved.link_version,saved.expected,saved.source,saved.title_choice,saved.description_choice,saved.actor_id,saved.actor_type) is distinct from row(p_project,p_import,p_version,p_expected,p_source,p_title,p_description,public.auth_app_user_id(),auth.jwt()->'app_metadata'->>'user_type') then raise exception 'GITHUB_SYNC_STALE' using errcode='40001';end if;
 return jsonb_build_object('event',to_jsonb(saved),'unchanged',true);
 end if;
 if not exists(select 1 from public.github_issue_task_imports where id=p_import and project_id=p_project and organization_id=public.auth_org()) then raise exception 'GITHUB_SYNC_NOT_FOUND' using errcode='P0002';end if;
 insert into public.github_issue_task_syncs(id,import_id,link_version,expected,source,title_choice,description_choice)
 values(p_id,p_import,p_version,p_expected,p_source,p_title,p_description) returning * into saved;
 update public.developer_tasks set task_title=saved.applied->>'title',task_description=saved.applied->>'description',updated_at=clock_timestamp()
 where id=saved.task_id and organization_id=public.auth_org() and project_id=p_project;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'GITHUB_SYNC_FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('event',to_jsonb(saved),'unchanged',false);
end$$;
revoke all on function public.sync_github_issue_task(uuid,uuid,uuid,integer,text,jsonb,text,text) from public,anon;
grant execute on function public.sync_github_issue_task(uuid,uuid,uuid,integer,text,jsonb,text,text) to authenticated;
commit;
