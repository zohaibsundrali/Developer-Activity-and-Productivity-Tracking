begin;
create table app_private.platform_staff (
 auth_user_id uuid primary key references auth.users(id) on delete restrict,
 role text not null check(role in ('support','billing')), mfa_required boolean not null default true,
 created_at timestamptz not null default now()
);
alter table app_private.platform_owners add column mfa_required boolean not null default false;
create table app_private.platform_revoked_sessions (session_id uuid primary key, auth_user_id uuid not null, revoked_at timestamptz not null default now());
alter table app_private.platform_staff enable row level security;
alter table app_private.platform_revoked_sessions enable row level security;
revoke all on app_private.platform_staff,app_private.platform_revoked_sessions from public,anon,authenticated,service_role;
create function public.platform_session_active(p_auth uuid,p_session uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=p_session and s.user_id=p_auth and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 and ((to_jsonb(s)->>'not_after') is null or (to_jsonb(s)->>'not_after')::timestamptz>now())
 and not exists(select 1 from app_private.platform_revoked_sessions r where r.session_id=s.id));
$$;
revoke all on function public.platform_session_active(uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_session_active(uuid,uuid) to service_role;
create function public.platform_access(p_auth uuid,p_session uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare r text; required boolean; satisfied boolean; permissions text[];
begin
 if not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id where u.id=p_auth and s.id=p_session
 and u.deleted_at is null and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
 and ((to_jsonb(s)->>'not_after') is null or (to_jsonb(s)->>'not_after')::timestamptz>now())
 and not exists(select 1 from app_private.platform_revoked_sessions x where x.session_id=s.id)) then return null; end if;
 select 'owner',mfa_required into r,required from app_private.platform_owners where auth_user_id=p_auth;
 if r is null then select role,mfa_required into r,required from app_private.platform_staff where auth_user_id=p_auth; end if;
 if r is null then return null; end if;
 select (to_jsonb(s)->>'aal')='aal2' and exists(select 1 from auth.mfa_factors f where f.user_id=p_auth and f.status='verified') into satisfied from auth.sessions s where id=p_session;
 permissions:=case r when 'owner' then array['overview.read','organizations.read','organizations.manage','members.manage','projects.read','projects.manage','billing.read','billing.manage','analytics.read','health.read','alerts.manage','team.manage','activity.read']
 when 'support' then array['overview.read','organizations.read','organizations.manage','members.manage','projects.read','projects.manage','health.read','alerts.manage','activity.read']
 else array['organizations.read','billing.read','billing.manage','analytics.read','health.read','alerts.manage'] end;
 return jsonb_build_object('role',r,'permissions',permissions,'mfaRequired',required,'mfaSatisfied',coalesce(satisfied,false));
end $$;
create or replace function public.platform_owner_access(p_auth uuid,p_session uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select coalesce((a->>'role')='owner' and (not (a->>'mfaRequired')::boolean or (a->>'mfaSatisfied')::boolean),false) from (select public.platform_access(p_auth,p_session) a) s;
$$;
create function app_private.require_platform_permission(p_auth uuid,p_session uuid,p_permission text) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare a jsonb:=public.platform_access(p_auth,p_session);
begin
 if a is null or not (a->'permissions' ? p_permission) then raise exception 'Platform permission required' using errcode='42501'; end if;
 if (a->>'mfaRequired')::boolean and not (a->>'mfaSatisfied')::boolean then raise exception 'MFA_REQUIRED' using errcode='42501'; end if;
end $$;
create function public.platform_record_access(p_auth uuid,p_session uuid,p_permission text,p_path text) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform app_private.require_platform_permission(p_auth,p_session,p_permission);
 insert into app_private.platform_audit(actor_id,action,reason) values(p_auth,'access.'||p_permission,left(p_path,200));
end $$;
-- Preserve the established workspace authority while revoking old sessions immediately.
alter function app_private.workspace_context(uuid,uuid,boolean) rename to workspace_context_before_platform;
create function app_private.workspace_context(p_auth uuid,p_session uuid,p_allow_deletion boolean default false) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select app_private.workspace_context_before_platform(p_auth,p_session,p_allow_deletion)
 where (p_session is null or exists(select 1 from auth.sessions s where s.id=p_session and s.user_id=p_auth and ((to_jsonb(s)->>'not_after') is null or (to_jsonb(s)->>'not_after')::timestamptz>now())))
 and not exists(select 1 from app_private.platform_revoked_sessions where session_id=p_session);
$$;
-- Only the service API / SQL operator may change platform suspension state.
create function public.guard_platform_organization_status() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if new.status is distinct from old.status and current_user not in ('postgres','supabase_admin','service_role') then raise exception 'Platform status is managed by the platform team' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_platform_organization_status() from public,anon,authenticated;
create trigger platform_organization_status before update of status on public.organizations for each row execute function public.guard_platform_organization_status();
create function public.platform_management_list(p_auth uuid,p_session uuid,p_kind text,p_org uuid default null,p_search text default '',p_page integer default 1,p_status text default '',p_from timestamptz default null,p_to timestamptz default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 perform app_private.require_platform_permission(p_auth,p_session,case p_kind when 'team' then 'team.manage' when 'members' then 'members.manage' else 'organizations.read' end);
 if p_page<1 or p_page>100000 or p_status not in ('','all','active','invited','suspended') then raise exception 'Invalid page or status' using errcode='22023'; end if;
 if p_kind='team' then
 with team as (
 select p.auth_user_id,u.email,'owner' role,p.mfa_required from app_private.platform_owners p join auth.users u on u.id=p.auth_user_id
 union all select p.auth_user_id,u.email,p.role,p.mfa_required from app_private.platform_staff p join auth.users u on u.id=p.auth_user_id)
 select jsonb_build_object('total',(select count(*) from team),'page',p_page,'pageSize',20,'items',coalesce((select jsonb_agg(x) from (select * from team order by email,auth_user_id limit 20 offset (p_page-1)*20) x),'[]'::jsonb)) into result;
 elsif p_kind='organization' then select jsonb_build_object('id',id,'name',name,'status',status) into result from public.organizations where id=p_org;
 elsif p_kind='members' then
 select jsonb_build_object('total',(select count(*) from public.memberships m where (p_org is null or m.organization_id=p_org) and (p_status in ('','all') or m.status=p_status) and (p_from is null or m.created_at>=p_from) and (p_to is null or m.created_at<p_to) and strpos(lower(coalesce(m.email,'')),lower(left(p_search,100)))>0), 'page',p_page,'pageSize',20,'items',coalesce((select jsonb_agg(x) from (
 select m.id,m.organization_id,o.name organization_name,m.email,m.role,m.status,m.user_type from public.memberships m join public.organizations o on o.id=m.organization_id where (p_org is null or m.organization_id=p_org) and (p_status in ('','all') or m.status=p_status) and (p_from is null or m.created_at>=p_from) and (p_to is null or m.created_at<p_to) and strpos(lower(coalesce(m.email,'')),lower(left(p_search,100)))>0 order by m.created_at desc,m.id limit 20 offset (p_page-1)*20) x),'[]'::jsonb)) into result;
 else raise exception 'Invalid list' using errcode='22023'; end if;
 return result;
end $$;
create function public.platform_management_mutate(p_auth uuid,p_session uuid,p_action text,p_data jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare org uuid; m public.memberships%rowtype; target uuid; desired text; platform_role text; result jsonb:='{"success":true}'::jsonb; invite uuid; token text;
begin
 perform app_private.require_platform_permission(p_auth,p_session,case when p_action like 'team.%' then 'team.manage' when p_action like 'member.%' then 'members.manage' else 'organizations.manage' end);
 if length(btrim(coalesce(p_reason,''))) not between 8 and 500 then raise exception 'Reason must be 8–500 characters' using errcode='22023'; end if;
 platform_role:=public.platform_access(p_auth,p_session)->>'role';
 if p_action='organization.status' then
 org:=(p_data->>'organizationId')::uuid; desired:=p_data->>'status';
 if desired not in ('active','suspended') or desired is null then raise exception 'Invalid status' using errcode='22023'; end if;
 update public.organizations set status=desired,updated_at=now() where id=org;
 if not found then raise exception 'Organization not found' using errcode='22023'; end if;
 elsif p_action in ('member.role','member.status','member.sessions') then
 select * into m from public.memberships where id=(p_data->>'membershipId')::uuid;
 if m.id is null then raise exception 'Member not found' using errcode='22023'; end if;
 org:=m.organization_id; perform pg_advisory_xact_lock(hashtextextended('platform-members:'||org::text,0));
 select * into m from public.memberships where id=m.id for update;
 if m.user_type='admin' then select auth_user_id into target from public.admin_users where id=m.user_id and organization_id=org;
 elsif m.user_type='developer' then select auth_user_id into target from public.developers where id=m.user_id and organization_id=org;
 else select auth_user_id into target from public.clients where id=m.user_id and organization_id=org; end if;
 if target=p_auth then raise exception 'Cannot modify your own membership or sessions' using errcode='42501'; end if;
 if exists(select 1 from app_private.platform_owners where auth_user_id=target) or exists(select 1 from app_private.platform_staff where auth_user_id=target) then raise exception 'Platform staff identities are protected; manage their platform access separately' using errcode='42501'; end if;
 if m.role='owner' and platform_role<>'owner' then raise exception 'Only platform owners may manage workspace owners' using errcode='42501'; end if;
 if m.role='owner' and m.status='active' and p_action<>'member.sessions' and not exists(select 1 from public.memberships where organization_id=org and id<>m.id and role='owner' and status='active') then raise exception 'The last active workspace owner is protected' using errcode='23514'; end if;
 if p_action='member.role' then
 desired:=p_data->>'role';
 if desired is null or desired not in ('owner','admin','manager','hr','finance','team_lead','qa','developer','designer','devops','employee','client') or (m.user_type='client')<>(desired='client') or (desired='owner' and platform_role<>'owner') then raise exception 'Invalid role assignment' using errcode='22023'; end if;
 -- Update the global fallback only if it represents this exact workspace; per-session claims derive fresh membership roles.
 update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}',to_jsonb(desired)) where id=target and raw_app_meta_data->>'organization_id'=org::text and raw_app_meta_data->>'app_user_id'=m.user_id::text;
 update public.memberships set role=desired,updated_at=now() where id=m.id;
 elsif p_action='member.status' then
 desired:=p_data->>'status'; if desired not in ('active','suspended') or desired is null then raise exception 'Invalid status' using errcode='22023'; end if;
 update public.memberships set status=desired,updated_at=now() where id=m.id;
 else
 if target is null then raise exception 'Member has no linked login' using errcode='22023'; end if;
 insert into app_private.platform_revoked_sessions(session_id,auth_user_id) select id,user_id from auth.sessions where user_id=target on conflict do nothing;
 result:=result||jsonb_build_object('message','Existing application sessions revoked across all workspaces. The user can sign in again.');
 end if;
 elsif p_action='member.invite' then
 org:=(p_data->>'organizationId')::uuid; desired:=p_data->>'role';
 if desired is null or desired not in ('owner','admin','manager','hr','finance','team_lead','qa','developer','designer','devops','employee','client') or desired='owner' or coalesce(p_data->>'email','') !~ '^[^ @]+@[^ @]+\.[^ @]+$' then raise exception 'Invalid invitation' using errcode='22023'; end if;
 if not exists(select 1 from public.organizations where id=org and status='active') then raise exception 'Organization must be active' using errcode='22023'; end if;
 token:=gen_random_uuid()::text;
 insert into public.invitations(organization_id,email,role,token,status,expires_at) values(org,lower(btrim(p_data->>'email')),desired,token,'pending',now()+interval '7 days') returning id into invite;
 result:=jsonb_build_object('success',true,'invitationId',invite,'token',token);
 elsif p_action in ('team.upsert','team.remove','team.mfa') then
 perform pg_advisory_xact_lock(hashtextextended('platform-team',0));
 if p_action='team.mfa' then target:=p_auth;
 elsif p_action='team.upsert' then select id into target from auth.users where lower(email)=lower(btrim(p_data->>'email')) and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<=now());
 else target:=(p_data->>'authUserId')::uuid; end if;
 if target is null then raise exception 'A verified existing login is required' using errcode='22023'; end if;
 if p_action<>'team.mfa' and target=p_auth then raise exception 'Cannot change your own platform access' using errcode='42501'; end if;
 if p_action='team.mfa' then
 if (p_data->>'mfaRequired')::boolean and not (public.platform_access(p_auth,p_session)->>'mfaSatisfied')::boolean then raise exception 'Verify MFA before requiring it' using errcode='22023'; end if;
 update app_private.platform_owners set mfa_required=(p_data->>'mfaRequired')::boolean where auth_user_id=target;
 else
 if exists(select 1 from app_private.platform_owners where auth_user_id=target) and (select count(*) from app_private.platform_owners)<=1 and (p_action='team.remove' or p_data->>'role' is distinct from 'owner') then raise exception 'Last platform owner is protected' using errcode='23514'; end if;
 desired:=p_data->>'role';
 if p_action='team.upsert' and (desired not in ('owner','support','billing') or desired is null) then raise exception 'Invalid platform role' using errcode='22023'; end if;
 delete from app_private.platform_staff where auth_user_id=target; delete from app_private.platform_owners where auth_user_id=target;
 if p_action='team.upsert' then
 if desired='owner' then insert into app_private.platform_owners(auth_user_id,mfa_required) values(target,coalesce((p_data->>'mfaRequired')::boolean,true));
 else insert into app_private.platform_staff(auth_user_id,role,mfa_required) values(target,desired,coalesce((p_data->>'mfaRequired')::boolean,true)); end if;
 end if;
 end if;
 else raise exception 'Invalid action' using errcode='22023'; end if;
 insert into app_private.platform_audit(actor_id,organization_id,action,reason) values(p_auth,org,p_action,p_reason||coalesce(' [target: '||coalesce(target::text,m.id::text,p_data->>'email')||']',''));
 return result;
end $$;
-- A delegated platform operator must also survive organization cleanup.
do $$ declare definition text; begin
 select pg_get_functiondef('public.check_deletion_auth_identity(uuid,uuid,uuid)'::regprocedure) into definition;
 definition:=replace(definition,'exists(select 1 from app_private.platform_owners where auth_user_id::text=i.resource_id)', '(exists(select 1 from app_private.platform_owners where auth_user_id::text=i.resource_id) or exists(select 1 from app_private.platform_staff where auth_user_id::text=i.resource_id))');
 execute definition;
end $$;
create function public.platform_organizations_filtered(p_auth uuid,p_session uuid,p_search text default '',p_page integer default 1,p_status text default '',p_from timestamptz default null,p_to timestamptz default null,p_org uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 perform app_private.require_platform_permission(p_auth,p_session,'organizations.read');
 if p_page<1 or p_page>100000 or p_status not in ('','all','active','suspended') then raise exception 'Invalid filters' using errcode='22023'; end if;
 with matching as (select o.* from public.organizations o where (p_search='' or strpos(lower(o.name),lower(left(p_search,100)))>0 or o.id::text=p_search) and (p_status in ('','all') or o.status=p_status) and (p_org is null or o.id=p_org) and (p_from is null or o.created_at>=p_from) and (p_to is null or o.created_at<p_to))
 select jsonb_build_object('total',(select count(*) from matching),'page',p_page,'pageSize',20,'items',coalesce((select jsonb_agg(x) from (
 select o.id,o.name,o.status,o.created_at,o.industry,o.country,o.timezone,(select count(*) from public.projects p where p.organization_id=o.id) projects,(select count(*) from public.memberships m where m.organization_id=o.id and m.status='active') members,(select count(*) from public.developer_tasks t where t.organization_id=o.id) tasks,(select j.status from app_private.organization_deletions j where j.organization_id=o.id) deletion_status from matching o order by o.created_at desc,o.id limit 20 offset (p_page-1)*20) x),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.platform_organizations_filtered(uuid,uuid,text,integer,text,timestamptz,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.platform_organizations_filtered(uuid,uuid,text,integer,text,timestamptz,timestamptz,uuid) to service_role;
-- Existing reporting gets explicit capability guards; destructive RPCs keep owner checks.
do $$ declare r record; definition text; permission text; begin
 for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('platform_overview','platform_organizations','platform_organization_detail','platform_activity') loop
 permission:=case r.proname when 'platform_overview' then 'overview.read' when 'platform_activity' then 'activity.read' else 'organizations.read' end;
 definition:=pg_get_functiondef(r.oid);
 definition:=replace(definition,'perform app_private.require_platform_owner(p_auth,p_session);',format('perform app_private.require_platform_permission(p_auth,p_session,%L);',permission));
 execute definition;
 end loop;
end $$;
do $$ declare r record; begin
 for r in select p.oid::regprocedure sig,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in ('platform_access','platform_record_access','platform_management_list','platform_management_mutate')) or (n.nspname='app_private' and p.proname in ('require_platform_permission','workspace_context')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.sig);
 if r.nspname='public' then execute format('grant execute on function %s to service_role',r.sig); end if;
 end loop;
end $$;
commit;
