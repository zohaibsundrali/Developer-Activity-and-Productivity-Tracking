begin;
-- One Auth identity may own multiple organization-specific admin profiles.
-- Passwords and the globally unique login email remain exclusively in Auth.
alter table public.admin_users drop constraint if exists admin_users_email_key;
create unique index admin_users_org_email on public.admin_users(organization_id,lower(btrim(email)));
create unique index admin_users_org_identity on public.admin_users(organization_id,auth_user_id) where auth_user_id is not null;

create table app_private.workspace_sessions (
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 auth_user_id uuid not null references auth.users(id) on delete cascade,
 organization_id uuid not null, profile_id uuid not null, user_type text not null,
 updated_at timestamptz not null default now()
);
create table app_private.workspace_creations (
 auth_user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null, organization_id uuid not null, created_at timestamptz not null default now(),
 primary key(auth_user_id,request_id)
);
alter table app_private.workspace_sessions enable row level security;
alter table app_private.workspace_creations enable row level security;
revoke all on app_private.workspace_sessions,app_private.workspace_creations from public,anon,authenticated,service_role;

-- No email matching. Both a current, typed profile link and an active
-- membership in that exact organization must belong to the verified identity.
create function app_private.accessible_workspaces(p_auth uuid,p_allow_deletion boolean default false)
returns table(organization_id uuid,profile_id uuid,user_type text,role text,full_name text)
language sql stable security definer set search_path=pg_catalog as $$
 select m.organization_id,p.id,p.kind,m.role,p.name from (
 select id,organization_id,auth_user_id,'admin'::text kind,full_name name from public.admin_users
 union all select id,organization_id,auth_user_id,'developer',name from public.developers
 union all select id,organization_id,auth_user_id,'client',name from public.clients
 ) p join public.memberships m on m.organization_id=p.organization_id and m.user_id=p.id and m.user_type=p.kind
 join public.organizations o on o.id=m.organization_id
 join auth.users u on u.id=p.auth_user_id
 where p.auth_user_id=p_auth and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 and m.status='active' and (p_allow_deletion or not m.deletion_blocked) and o.status='active'
 and public.role_rank(m.role) is not null and (m.user_type='client')=(m.role='client')
 and (p_allow_deletion or not app_private.organization_deleting(o.id));
$$;

create function app_private.workspace_context(p_auth uuid,p_session uuid,p_allow_deletion boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare chosen app_private.workspace_sessions%rowtype; metadata jsonb; result jsonb;
begin
 select * into chosen from app_private.workspace_sessions where session_id=p_session and auth_user_id=p_auth;
 if found then
  select jsonb_build_object('organization_id',w.organization_id,'app_user_id',w.profile_id,'user_type',w.user_type,'role',w.role)
  into result from app_private.accessible_workspaces(p_auth,p_allow_deletion) w
  where w.organization_id=chosen.organization_id and w.profile_id=chosen.profile_id and w.user_type=chosen.user_type;
  -- Do not silently fall back after access to a selected organization is revoked.
  return result;
 end if;
 select raw_app_meta_data into metadata from auth.users where id=p_auth;
 select jsonb_build_object('organization_id',w.organization_id,'app_user_id',w.profile_id,'user_type',w.user_type,'role',w.role)
 into result from app_private.accessible_workspaces(p_auth,p_allow_deletion) w
 where w.organization_id::text=metadata->>'organization_id' and w.profile_id::text=metadata->>'app_user_id'
 and w.user_type=metadata->>'user_type' and w.role=metadata->>'role';
 return result;
end $$;

create function public.workspace_context(p_auth uuid,p_session uuid,p_allow_deletion boolean default false) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.workspace_context(p_auth,p_session,p_allow_deletion)
 where exists(select 1 from auth.sessions where id=p_session and user_id=p_auth);
$$;

create function public.list_workspaces(p_auth uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'industry',o.industry,
 'companySize',o.company_size,'country',o.country,'timezone',o.timezone,'role',w.role,'userType',w.user_type,
 'profileId',w.profile_id,'fullName',w.full_name,
 'members',case when w.role in ('owner','admin') and not exists(select 1 from public.user_permissions up join public.memberships mm on mm.id=up.membership_id where mm.organization_id=w.organization_id and mm.user_id=w.profile_id and mm.user_type=w.user_type and up.permission_key='member.view' and up.allowed=false) then (select count(*) from public.memberships m where m.organization_id=o.id and m.status='active' and not m.deletion_blocked) end,
 'projects',case when w.role in ('owner','admin') and not exists(select 1 from public.user_permissions up join public.memberships mm on mm.id=up.membership_id where mm.organization_id=w.organization_id and mm.user_id=w.profile_id and mm.user_type=w.user_type and up.permission_key='project.view_all' and up.allowed=false) then (select count(*) from public.projects p where p.organization_id=o.id) end)
 order by o.name,o.id,w.profile_id),'[]'::jsonb)
 from app_private.accessible_workspaces(p_auth) w join public.organizations o on o.id=w.organization_id;
$$;

create function public.select_workspace(p_auth uuid,p_session uuid,p_org uuid,p_profile uuid,p_type text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if not exists(select 1 from auth.sessions where id=p_session and user_id=p_auth) then raise exception 'WORKSPACE_UNAUTHENTICATED'; end if;
 select jsonb_build_object('organization_id',w.organization_id,'app_user_id',w.profile_id,'user_type',w.user_type,'role',w.role)
 into result from app_private.accessible_workspaces(p_auth) w
 where w.organization_id=p_org and w.profile_id=p_profile and w.user_type=p_type;
 if result is null then raise exception 'WORKSPACE_FORBIDDEN'; end if;
 insert into app_private.workspace_sessions(session_id,auth_user_id,organization_id,profile_id,user_type)
 values(p_session,p_auth,p_org,p_profile,p_type)
 on conflict(session_id) do update set organization_id=excluded.organization_id,profile_id=excluded.profile_id,
 user_type=excluded.user_type,updated_at=now() where workspace_sessions.auth_user_id=p_auth;
 return result;
end $$;

-- Enable this hook in Supabase Auth before deploying the application. Claims
-- are issued per Auth session: selecting here never changes another device.
create function public.workspace_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare claims jsonb:=event->'claims'; metadata jsonb;
begin
 metadata:=app_private.workspace_context((event->>'user_id')::uuid,(claims->>'session_id')::uuid);
 -- Clear workspace claims when a membership has been revoked. The identity
 -- can still reach its organization chooser and another authorized workspace.
 claims:=jsonb_set(claims,'{app_metadata}',
 (coalesce(claims->'app_metadata','{}'::jsonb)-'organization_id'-'app_user_id'-'user_type'-'role')||coalesce(metadata,'{}'::jsonb));
 return jsonb_build_object('claims',claims);
end $$;

-- These claims are set ONLY by the service-only leased job executor, never
-- by user metadata or by the Auth hook. Both actor identity and lease are read
-- again for each RLS operation, preserving revocation during background work.
create function app_private.automation_workspace_context(p_auth uuid,p_job uuid,p_lease uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('organization_id',w.organization_id,'app_user_id',w.profile_id,'user_type',w.user_type,'role',w.role)
 from public.automation_jobs j join app_private.accessible_workspaces(p_auth) w
 on w.organization_id=j.organization_id and w.profile_id=j.actor_id and w.user_type=j.actor_type
 where j.id=p_job and j.lease=p_lease and j.status='processing' and j.lease_until>now();
$$;
revoke all on function app_private.automation_workspace_context(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Keep all existing RLS consumers. Only the authority for the chosen context
-- changes; profile links, exact roles, revocations and deletion locks remain.
create or replace function public.auth_org() returns uuid
language sql stable security definer set search_path=pg_catalog as $$
 select (c.metadata->>'organization_id')::uuid from
 (select case when auth.jwt()->>'session_id' is null and auth.jwt()->>'automation_job' is not null then
 app_private.automation_workspace_context(auth.uid(),(auth.jwt()->>'automation_job')::uuid,(auth.jwt()->>'automation_lease')::uuid)
 else app_private.workspace_context(auth.uid(),nullif(auth.jwt()->>'session_id','')::uuid) end metadata) c
 where auth.uid() is not null and c.metadata is not null
 and c.metadata <@ (auth.jwt()->'app_metadata');
$$;

create function public.create_authenticated_workspace(p_auth uuid,p_request uuid,p_details jsonb,p_plan text,p_terms text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare u auth.users%rowtype; oid uuid; pid uuid:=gen_random_uuid(); plan public.billing_plans%rowtype; display_name text;
begin
 if p_request is null or jsonb_typeof(p_details) is distinct from 'object'
 or length(btrim(coalesce(p_details->>'company',''))) not between 1 and 200
 or coalesce(length(p_terms),0)=0 then raise exception 'WORKSPACE_INVALID'; end if;
 select * into u from auth.users where id=p_auth for share;
 if u.id is null or u.email_confirmed_at is null or u.deleted_at is not null or (u.banned_until is not null and u.banned_until>now()) then raise exception 'WORKSPACE_UNAUTHENTICATED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('workspace-create:'||p_auth::text,0));
 select organization_id into oid from app_private.workspace_creations where auth_user_id=p_auth and request_id=p_request;
 if oid is not null then
  select profile_id into pid from app_private.accessible_workspaces(p_auth) where organization_id=oid and role='owner';
  if pid is null then raise exception 'WORKSPACE_FORBIDDEN'; end if;
  return jsonb_build_object('organizationId',oid,'profileId',pid,'userType','admin');
 end if;
 -- Bound accidental/replayed creation while allowing normal repeat use.
 if (select count(*) from app_private.workspace_creations where auth_user_id=p_auth and created_at>now()-interval '1 hour')>=5 then raise exception 'WORKSPACE_RATE_LIMIT'; end if;
 select full_name into display_name from app_private.accessible_workspaces(p_auth) order by (role='owner') desc limit 1;
 -- An existing verified account can also create a workspace after its last
 -- membership is removed. This name is display-only, never authorization.
 display_name:=left(coalesce(nullif(display_name,''),split_part(u.email,'@',1)),120);
 select * into plan from public.billing_plans where code=lower(btrim(p_plan)) and is_active=true and trial_days>0 and code<>'free';
 if plan.code is null then select * into plan from public.billing_plans where code='free' and is_active=true; end if;
 if plan.code is null then raise exception 'WORKSPACE_PLAN_UNAVAILABLE'; end if;
 if not exists(select 1 from pg_timezone_names where name=coalesce(nullif(p_details->>'timezone',''),'UTC')) then raise exception 'WORKSPACE_INVALID'; end if;
 oid:=gen_random_uuid();
 insert into public.admin_users(id,full_name,company,email,is_verified,role,auth_user_id)
 values(pid,display_name,btrim(p_details->>'company'),lower(btrim(u.email)),true,'admin',p_auth);
 insert into public.organizations(id,name,owner_id,industry,company_size,country,timezone)
 values(oid,btrim(p_details->>'company'),pid,left(p_details->>'industry',200),left(p_details->>'companySize',100),left(p_details->>'country',100),coalesce(nullif(p_details->>'timezone',''),'UTC'));
 update public.admin_users set organization_id=oid where id=pid;
 insert into public.organization_subscriptions(organization_id,plan_code,status,trial_start,trial_end)
 values(oid,plan.code,case when plan.code='free' then 'active' else 'trialing' end,
 case when plan.code<>'free' then now() end,case when plan.code<>'free' then now()+make_interval(days=>plan.trial_days::integer) end);
 insert into public.memberships(organization_id,user_id,user_type,email,role,status) values(oid,pid,'admin',lower(btrim(u.email)),'owner','active');
 insert into public.terms_acceptances(organization_id,user_id,user_type,email,document,document_version,entry_point,accepted_at)
 values(oid,pid,'admin',lower(btrim(u.email)),'terms_of_service',p_terms,'signup',now());
 insert into app_private.workspace_creations(auth_user_id,request_id,organization_id) values(p_auth,p_request,oid);
 return jsonb_build_object('organizationId',oid,'profileId',pid,'userType','admin');
end $$;

revoke all on function app_private.accessible_workspaces(uuid,boolean),app_private.workspace_context(uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.workspace_context(uuid,uuid,boolean),public.list_workspaces(uuid),public.select_workspace(uuid,uuid,uuid,uuid,text),public.create_authenticated_workspace(uuid,uuid,jsonb,text,text),public.workspace_access_token_hook(jsonb) from public,anon,authenticated;
grant execute on function public.workspace_context(uuid,uuid,boolean),public.list_workspaces(uuid),public.select_workspace(uuid,uuid,uuid,uuid,text),public.create_authenticated_workspace(uuid,uuid,jsonb,text,text) to service_role;
revoke all on function public.workspace_access_token_hook(jsonb) from service_role;
grant execute on function public.workspace_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
revoke all on function public.auth_org() from public,anon;
grant execute on function public.auth_org() to authenticated;

-- Existing workspace lifecycle operations must also accept linked secondary profiles.
create or replace function public.start_organization_deletion(p_org uuid,p_actor uuid,p_type text,p_auth uuid,p_name text,p_receipt_hash text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare m public.memberships%rowtype; j app_private.organization_deletions%rowtype; org_name text; linked uuid; busy boolean; nonce uuid:=gen_random_uuid();
begin
 perform app_private.lock_quota(p_org);
 select * into m from public.memberships where organization_id=p_org and user_id=p_actor and user_type=p_type and status='active' for update;
 if not found or m.role<>'owner' or p_type not in ('admin','developer') or not coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='organization.delete'),true) then raise exception 'Deletion requires the active owner' using errcode='42501'; end if;
 if p_type='admin' then select auth_user_id into linked from public.admin_users where id=p_actor and organization_id=p_org;
 else select auth_user_id into linked from public.developers where id=p_actor and organization_id=p_org; end if;
 if linked is distinct from p_auth or not exists(select 1 from app_private.accessible_workspaces(p_auth,true) w where w.organization_id=p_org and w.profile_id=p_actor and w.user_type=p_type and w.role='owner') then raise exception 'Owner identity must be verified' using errcode='42501'; end if;
 select * into j from app_private.organization_deletions where organization_id=p_org for update;
 if found then
  if p_name is distinct from j.organization_name or p_receipt_hash is null or p_receipt_hash !~ '^[0-9a-f]{64}$' then raise exception 'Confirm the exact organization name' using errcode='22023'; end if;
  update app_private.organization_deletions set receipt_hash=p_receipt_hash where id=j.id;return j.id; end if;
 select name into org_name from public.organizations where id=p_org for update;
 if not found or p_name is distinct from org_name or p_receipt_hash !~ '^[0-9a-f]{64}$' then raise exception 'Confirm the exact organization name' using errcode='22023'; end if;
 if exists(select 1 from storage.objects o where app_private.deletion_storage_org(o.bucket_id,o.name) is null and
  (exists(select 1 from public.screenshots s where s.organization_id=p_org and s.storage_path=o.name)
   or exists(select 1 from auth.users u where u.id::text=coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner') and u.raw_app_meta_data->>'organization_id'=p_org::text))) then
  raise exception 'Legacy or ambiguous storage ownership requires repair before organization deletion' using errcode='22023'; end if;
 if to_regclass('app_private.invitation_attempts') is not null then
  execute 'select exists(select 1 from app_private.invitation_attempts a join public.invitations i on i.id=a.invitation_id where i.organization_id=$1 and a.completed_at is null and a.lease_until>now())' into busy using p_org;
  if busy then raise exception 'Invitation acceptance is in progress; retry deletion shortly' using errcode='22023'; end if;
 end if;
 insert into app_private.organization_deletions(organization_id,organization_name,actor_id,actor_type,auth_user_id,receipt_hash,status,lease,lease_until,stripe_customer_id,stripe_subscription_id)
 select p_org,org_name,p_actor,p_type,p_auth,p_receipt_hash,'processing',nonce,now()+interval '10 minutes',s.stripe_customer_id,s.stripe_subscription_id
 from (select 1) x left join public.organization_subscriptions s on s.organization_id=p_org returning * into j;
 perform set_config('app.deletion_lease',nonce::text,true);
 update public.memberships set deletion_blocked=true where organization_id=p_org;
 insert into app_private.organization_deletion_items(job_id,kind,resource_id,bucket,path)
 select j.id,'storage',o.id::text,o.bucket_id,o.name from storage.objects o where app_private.deletion_storage_org(o.bucket_id,o.name)=p_org;
 -- Include only linked profiles in this org. Shared or mismatched links are
 -- marked retained at execution; no password or Auth credential is inspected.
 insert into app_private.organization_deletion_items(job_id,kind,resource_id,profile_id,profile_type)
 select j.id,'auth',auth_user_id::text,id,kind from (
 select id,auth_user_id,'admin'::text kind from public.admin_users where organization_id=p_org and auth_user_id is not null
 union all select id,auth_user_id,'developer' from public.developers where organization_id=p_org and auth_user_id is not null
 union all select id,auth_user_id,'client' from public.clients where organization_id=p_org and auth_user_id is not null) p
 on conflict(job_id,kind,resource_id) do nothing;
 if to_regclass('app_private.invitation_attempts') is not null then
  execute $q$insert into app_private.organization_deletion_items(job_id,kind,resource_id,profile_id,profile_type,invitation_id)
   select $1,'auth',a.auth_user_id::text,a.profile_id,case when i.role='admin' then 'admin' when i.role='client' then 'client' else 'developer' end,i.id
   from app_private.invitation_attempts a join public.invitations i on i.id=a.invitation_id where i.organization_id=$2
   on conflict(job_id,kind,resource_id) do nothing$q$ using j.id,p_org;
 end if;
 update app_private.organization_deletions set status='pending',lease=null,lease_until=null where id=j.id;
 return j.id;
end $$;


create or replace function public.run_unattended_automation_step(p_job uuid,p_lease uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare job public.automation_jobs%rowtype; member public.memberships%rowtype; profile_auth uuid; auth_record jsonb; claims_before text;
 result jsonb; action jsonb; target uuid; target_type text; recipient public.memberships%rowtype; notice jsonb; actor_role text;
begin
 select * into job from public.automation_jobs where id=p_job and lease=p_lease and status='processing' and lease_until>now() for update;
 if not found then raise exception 'Automation lease expired' using errcode='42501'; end if;
 if not app_private.plan_feature(job.organization_id,'automation') or app_private.organization_deleting(job.organization_id) then
  raise exception 'Automation organization is unavailable' using errcode='42501'; end if;
 select * into member from public.memberships where organization_id=job.organization_id and user_id=job.actor_id and user_type=job.actor_type
  and status='active' and user_type in ('admin','developer') and role<>'client' for share;
 if not found then raise exception 'Automation actor is inactive' using errcode='42501'; end if;
 if job.actor_type='admin' then
  select auth_user_id into profile_auth from public.admin_users where id=job.actor_id and organization_id=job.organization_id;
 else
  select auth_user_id into profile_auth from public.developers where id=job.actor_id and organization_id=job.organization_id;
 end if;
 select to_jsonb(u) into auth_record from auth.users u where u.id=profile_auth;
 if auth_record is null or auth_record->>'deleted_at' is not null
  or coalesce((auth_record->>'banned_until')::timestamptz>now(),false)
 then
  raise exception 'Automation actor Auth identity is unavailable' using errcode='42501'; end if;
 actor_role:=member.role;
 if public.role_rank(actor_role) is null then raise exception 'Automation actor role is invalid' using errcode='42501'; end if;
 claims_before:=current_setting('request.jwt.claims',true);
 begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',profile_auth,'role','authenticated','automation_job',job.id,'automation_lease',job.lease,'app_metadata',
    jsonb_build_object('organization_id',job.organization_id,'app_user_id',job.actor_id,'user_type',job.actor_type,'role',actor_role))::text,true);
  if p_operation='notice' then
   -- Identity/content come only from the stored job, never worker parameters.
   result:=private.run_automation_as_actor(p_job,p_lease,'read');
   action:=job.actions->job.next_action;
   target:=public.try_uuid(case when action->>'target'='user' then action->>'userId' else coalesce(result->>'developer_id',action->>'userId') end);
   target_type:=nullif(action->>'userType','');
   if action->>'type'='notify' then target_type:=coalesce(target_type,'developer'); end if;
   if (select count(*) from public.memberships where organization_id=job.organization_id and user_id=target and user_type in ('admin','developer')
     and (target_type is null or user_type=target_type))<>1 then raise exception 'Automation recipient is ambiguous or unavailable' using errcode='42501'; end if;
   select * into recipient from public.memberships where organization_id=job.organization_id and user_id=target and user_type in ('admin','developer')
     and (target_type is null or user_type=target_type) and status='active';
   if not found then raise exception 'Automation recipient is inactive' using errcode='42501'; end if;
   notice:=jsonb_build_object('title',coalesce(action->>'subject',action->>'title','Task update'),
    'message',coalesce(action->>'message',format('Task "%s" was updated.',coalesce(result->>'task_title','Untitled'))),
    'developer_id',case when recipient.user_type='developer' then recipient.user_id end,
    'admin_id',case when recipient.user_type='admin' then recipient.user_id end,
    'admin_recipient_type',case when recipient.user_type='admin' then 'admin' end);
   if length(notice->>'title')>500 or length(notice->>'message')>20000 then raise exception 'Invalid automation message' using errcode='22023'; end if;
  end if;
  result:=private.run_automation_as_actor(p_job,p_lease,p_operation,notice);
  perform set_config('request.jwt.claims',coalesce(claims_before,''),true);
  return result;
 exception when others then
  perform set_config('request.jwt.claims',coalesce(claims_before,''),true);
  raise;
 end;
end $$;
commit;
