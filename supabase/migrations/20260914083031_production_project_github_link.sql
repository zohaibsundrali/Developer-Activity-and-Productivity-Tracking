begin;
create table public.project_github_links (
 project_id uuid primary key references public.projects(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 repository_id bigint, owner text, repository text, version integer not null check(version>0),
 updated_by uuid not null, updated_by_type text not null check(updated_by_type in ('admin','developer')), updated_at timestamptz not null default now(),
 check((repository_id is null and owner is null and repository is null) or (repository_id is not null and repository_id>0 and owner is not null and owner~'^[A-Za-z0-9][A-Za-z0-9-]{0,38}$' and repository is not null and repository~'^[A-Za-z0-9_.-]{1,100}$' and repository not in ('.','..')))
);
create index project_github_links_org on public.project_github_links(organization_id,project_id);
alter table public.project_github_links enable row level security;
revoke all on public.project_github_links from public,anon,authenticated;
grant select on public.project_github_links to authenticated;
create function app_private.can_read_project_github(p_project uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and public.auth_org() is not null and not public.auth_is_client()
 and auth.jwt()->'app_metadata'->>'user_type' in ('admin','developer')
 and exists(select 1 from public.projects p where p.id=p_project and p.organization_id=public.auth_org()
 and (coalesce(public.auth_override('project.view_all'),public.auth_role() in ('owner','admin','manager','team_lead'),false)
 or (coalesce(public.auth_override('project.view_own'),true) and (
 public.project_actor_is_owner(p.organization_id,p.id,public.auth_app_user_id(),auth.jwt()->'app_metadata'->>'user_type')
 or public.project_actor_is_manager(p.organization_id,p.id,public.auth_app_user_id(),auth.jwt()->'app_metadata'->>'user_type')
 or exists(select 1 from public.project_members m where m.organization_id=p.organization_id and m.project_id=p.id and m.user_id=public.auth_app_user_id() and m.user_type=auth.jwt()->'app_metadata'->>'user_type')))));
$$;
revoke all on function app_private.can_read_project_github(uuid) from public,anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.can_read_project_github(uuid) to authenticated;
create function public.can_read_project_github(p_project uuid) returns boolean language sql stable security invoker set search_path=pg_catalog,public,app_private as $$select app_private.can_read_project_github(p_project);$$;
revoke all on function public.can_read_project_github(uuid) from public,anon;
grant execute on function public.can_read_project_github(uuid) to authenticated;
create policy project_github_links_read on public.project_github_links for select to authenticated using(organization_id=(select public.auth_org()) and public.can_read_project_github(project_id));
create function public.project_github_context(p_project uuid) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if not coalesce(public.can_read_project_github(p_project),false) then raise exception 'GITHUB_PROJECT_FORBIDDEN' using errcode='42501'; end if;
 select to_jsonb(g) into result from public.project_github_links g where g.project_id=p_project and g.organization_id=public.auth_org();
 return jsonb_build_object('project_id',p_project,'organization_id',public.auth_org(),'link',result,'can_manage',coalesce(public.auth_project_staffing(p_project,'project.manage_members'),false));
end $$;
revoke all on function public.project_github_context(uuid) from public,anon;
grant execute on function public.project_github_context(uuid) to authenticated;
create function app_private.save_project_github(p_project uuid,p_version integer,p_repository_id bigint,p_owner text,p_repository text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); actor uuid:=public.auth_app_user_id(); kind text:=auth.jwt()->'app_metadata'->>'user_type'; oldrow public.project_github_links%rowtype; saved public.project_github_links%rowtype;
begin
 if org is null or actor is null or kind is null or kind not in ('admin','developer') or not coalesce(public.auth_project_staffing(p_project,'project.manage_members'),false) then raise exception 'GITHUB_PROJECT_FORBIDDEN' using errcode='42501'; end if;
 if p_version is null or p_version<0 or p_version>=2147483647 or (p_repository_id is null and (p_owner is not null or p_repository is not null))
 or (p_repository_id is not null and (p_repository_id<=0 or p_repository_id>9007199254740991 or p_owner is null or p_owner!~'^[A-Za-z0-9][A-Za-z0-9-]{0,38}$' or p_repository is null or p_repository!~'^[A-Za-z0-9_.-]{1,100}$' or p_repository in ('.','..'))) then raise exception 'GITHUB_LINK_INVALID' using errcode='22023'; end if;
 perform app_private.lock_quota(org);
 if public.auth_org() is distinct from org or not coalesce(public.auth_project_staffing(p_project,'project.manage_members'),false) then raise exception 'GITHUB_PROJECT_FORBIDDEN' using errcode='42501'; end if;
 if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED'; end if;
 perform 1 from public.projects where id=p_project and organization_id=org for update;
 if not found then raise exception 'GITHUB_PROJECT_NOT_FOUND' using errcode='P0002'; end if;
 select * into oldrow from public.project_github_links where project_id=p_project and organization_id=org for update;
 if found then
  if oldrow.version=p_version+1 and oldrow.updated_by=actor and oldrow.updated_by_type=kind and row(oldrow.repository_id,oldrow.owner,oldrow.repository) is not distinct from row(p_repository_id,p_owner,p_repository) then return to_jsonb(oldrow); end if;
  if oldrow.version<>p_version then raise exception 'GITHUB_LINK_STALE' using errcode='40001'; end if;
 else
  if p_version<>0 then raise exception 'GITHUB_LINK_STALE' using errcode='40001'; end if;
 end if;
 insert into public.project_github_links(project_id,organization_id,repository_id,owner,repository,version,updated_by,updated_by_type)
 values(p_project,org,p_repository_id,p_owner,p_repository,p_version+1,actor,kind)
 on conflict(project_id) do update set repository_id=excluded.repository_id,owner=excluded.owner,repository=excluded.repository,version=excluded.version,updated_by=actor,updated_by_type=kind,updated_at=clock_timestamp() returning * into saved;
 return to_jsonb(saved);
end $$;
revoke all on function app_private.save_project_github(uuid,integer,bigint,text,text) from public,anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.save_project_github(uuid,integer,bigint,text,text) to authenticated;
create function public.save_project_github(p_project uuid,p_version integer,p_repository_id bigint,p_owner text,p_repository text) returns jsonb
language sql security invoker set search_path=pg_catalog,public,app_private as $$select app_private.save_project_github(p_project,p_version,p_repository_id,p_owner,p_repository);$$;
revoke all on function public.save_project_github(uuid,integer,bigint,text,text) from public,anon;
grant execute on function public.save_project_github(uuid,integer,bigint,text,text) to authenticated;
commit;
