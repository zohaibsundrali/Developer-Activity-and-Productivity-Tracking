begin;
-- Durable records intentionally have no organization FK: recovery and read-only
-- receipts survive deleting the tenant. No Auth or Storage rows are mutated here.
create table app_private.organization_deletions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null unique,organization_name text not null,
 actor_id uuid not null,actor_type text not null,auth_user_id uuid not null,receipt_hash text not null unique,
 status text not null default 'pending' check(status in ('pending','processing','retry','completed')),
 stage text not null default 'billing' check(stage in ('billing','storage','auth','database','completed')),
 stripe_customer_id text,stripe_subscription_id text,lease uuid,lease_until timestamptz,
 attempts integer not null default 0,next_attempt_at timestamptz not null default now(),last_error text,
 created_at timestamptz not null default now(),completed_at timestamptz);
create table app_private.organization_deletion_items(
 id uuid primary key default gen_random_uuid(),job_id uuid not null references app_private.organization_deletions on delete cascade,
 kind text not null check(kind in ('storage','auth')),resource_id text not null,bucket text,path text,profile_id uuid,profile_type text,invitation_id uuid,
 status text not null default 'pending' check(status in ('pending','done','retained')),unique(job_id,kind,resource_id));
alter table app_private.organization_deletions enable row level security;
alter table app_private.organization_deletion_items enable row level security;
revoke all on app_private.organization_deletions,app_private.organization_deletion_items from public,anon,authenticated,service_role;
create function app_private.organization_deleting(p_org uuid) returns boolean language sql stable security definer set search_path=pg_catalog,app_private as $$
 select exists(select 1 from app_private.organization_deletions where organization_id=p_org);
$$;
revoke all on function app_private.organization_deleting(uuid) from public,anon,authenticated;
grant execute on function app_private.organization_deleting(uuid) to service_role;
-- Membership flags make service API authentication fail closed without a new
-- unbounded lookup on every route. The dedicated recovery endpoint opts in.
alter table public.memberships add column deletion_blocked boolean not null default false;
create or replace function public.auth_org() returns uuid language sql stable security definer set search_path=pg_catalog,public,app_private as $$
 select m.organization_id from public.memberships m where auth.uid() is not null
 and m.organization_id=nullif(auth.jwt()->'app_metadata'->>'organization_id','')::uuid
 and m.user_id=nullif(auth.jwt()->'app_metadata'->>'app_user_id','')::uuid
 and m.user_type=auth.jwt()->'app_metadata'->>'user_type' and m.status='active' and not m.deletion_blocked
 and public.role_rank(m.role) is not null and (m.user_type='client')=(m.role='client')
 and not app_private.organization_deleting(m.organization_id) limit 1;
$$;
-- Independent of the optional Storage accounting migration. Resolve only
-- evidenced application paths; conflicting legacy references never authorize.
create function app_private.deletion_storage_org(p_bucket text,p_name text) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare segment text:=split_part(p_name,'/',1); candidate uuid; legacy uuid; n int;
begin
 if p_bucket not in ('task-submissions','monitoring','org-files','invoices') then return null; end if;
 if p_bucket='monitoring' and not exists(select 1 from public.developers where organization_id::text=segment and id::text=split_part(p_name,'/',2) and split_part(p_name,'/',3)<>'') then return null; end if;
 if p_bucket='task-submissions' then
  if segment='pm' then segment:=split_part(p_name,'/',2);
  elsif segment='submissions' then
   select organization_id into candidate from public.developers where id::text=split_part(p_name,'/',2);
   return candidate;
  end if;
 end if;
 select id into candidate from public.organizations where id::text=segment;
 if p_bucket in ('screenshots','documents','monitoring') then
  select count(distinct organization_id),min(organization_id::text)::uuid into n,legacy from public.screenshots where storage_path=p_name;
  if n>1 or (candidate is not null and legacy is not null and candidate<>legacy) then return null; end if;
  -- Mutable screenshot rows are not independent ownership proof. Legacy
  -- paths remain unresolved and block deletion when referenced by this org.
 end if;
 return candidate;
end $$;
revoke all on function app_private.deletion_storage_org(text,text) from public,anon,authenticated;
create function app_private.deletion_worker_context(p_org uuid) returns boolean language sql stable security definer set search_path=pg_catalog,app_private as $$
 select (current_setting('role',true)='service_role' or (coalesce(current_setting('role',true),'none') in ('none','postgres','supabase_admin') and session_user in ('postgres','supabase_admin')))
 and exists(select 1 from app_private.organization_deletions where organization_id=p_org and lease::text=current_setting('app.deletion_lease',true) and lease_until>now() and status='processing');
$$;
create function public.guard_organization_deleting() returns trigger language plpgsql security invoker set search_path=pg_catalog,public,app_private as $$
declare org uuid; old_org uuid;
begin
 if tg_table_name='organizations' then
  if tg_op<>'DELETE' then org:=new.id; end if;if tg_op<>'INSERT' then old_org:=old.id; end if;
 else
  if tg_op<>'DELETE' then org:=(to_jsonb(new)->>'organization_id')::uuid; end if;
  if tg_op<>'INSERT' then old_org:=(to_jsonb(old)->>'organization_id')::uuid; end if;
 end if;
 -- Serialize writes with the start snapshot using the same physical quota lock.
 if org is not null and exists(select 1 from public.organizations where id=org) then perform app_private.lock_quota(org); end if;
 if old_org is not null and old_org is distinct from org and exists(select 1 from public.organizations where id=old_org) then perform app_private.lock_quota(old_org); end if;
 if (app_private.organization_deleting(org) and not (app_private.deletion_worker_context(org)))
 or (app_private.organization_deleting(old_org) and not (app_private.deletion_worker_context(old_org))) then
  raise exception 'Organization deletion is in progress' using errcode='42501'; end if;
 if tg_table_name='memberships' and ((tg_op='INSERT' and (to_jsonb(new)->>'deletion_blocked')::boolean) or (tg_op='UPDATE' and to_jsonb(new)->'deletion_blocked' is distinct from to_jsonb(old)->'deletion_blocked')) and not app_private.deletion_worker_context(org) then raise exception 'Deletion access flag is managed by the deletion lifecycle' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;return new;
end $$;
-- Trigger must resolve the private predicate without giving clients ledger access.
alter function public.guard_organization_deleting() security definer;
revoke all on function public.guard_organization_deleting() from public,anon,authenticated;
do $$ declare t record;begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and (c.relname='organizations' or exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='organization_id' and not a.attisdropped)) loop
  execute format('create trigger aaa_organization_deleting before insert or update or delete on public.%I for each row execute function public.guard_organization_deleting()',t.relname);
 end loop;
end $$;
create function public.guard_deleting_storage() returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid;begin
 org:=app_private.deletion_storage_org(new.bucket_id,new.name);
 if org is not null then perform app_private.lock_quota(org); end if;
 if tg_op='UPDATE' and app_private.deletion_storage_org(old.bucket_id,old.name) is not null and app_private.deletion_storage_org(old.bucket_id,old.name) is distinct from org then perform app_private.lock_quota(app_private.deletion_storage_org(old.bucket_id,old.name)); end if;
 if app_private.organization_deleting(org) or (tg_op='UPDATE' and app_private.organization_deleting(app_private.deletion_storage_org(old.bucket_id,old.name))) then raise exception 'Organization deletion is in progress' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_deleting_storage() from public,anon,authenticated;
create trigger aaa_organization_deleting before insert or update on storage.objects for each row execute function public.guard_deleting_storage();

create function public.guard_deleting_auth_link() returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare linked_org uuid;begin
 if new.auth_user_id is not null then
  select o.id into linked_org from auth.users u join public.organizations o on o.id::text=u.raw_app_meta_data->>'organization_id' where u.id=new.auth_user_id;
  if linked_org is not null then perform app_private.lock_quota(linked_org); end if;
 end if;
 if new.auth_user_id is not null and (tg_op='INSERT' or new.auth_user_id is distinct from old.auth_user_id) and exists(
 select 1 from app_private.organization_deletion_items i join app_private.organization_deletions j on j.id=i.job_id
 where i.kind='auth' and i.resource_id=new.auth_user_id::text and i.status<>'retained' and j.status<>'completed') then
 raise exception 'Auth identity is scheduled for deletion' using errcode='42501'; end if;return new;
end $$;
revoke all on function public.guard_deleting_auth_link() from public,anon,authenticated;
create trigger deleting_auth_link before insert or update of auth_user_id on public.admin_users for each row execute function public.guard_deleting_auth_link();
create trigger deleting_auth_link before insert or update of auth_user_id on public.developers for each row execute function public.guard_deleting_auth_link();
create trigger deleting_auth_link before insert or update of auth_user_id on public.clients for each row execute function public.guard_deleting_auth_link();

create function public.guard_deleting_invitation_attempt() returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid;begin
 select organization_id into org from public.invitations where id=new.invitation_id;
 if org is not null then perform app_private.lock_quota(org); end if;
 if app_private.organization_deleting(org) and not app_private.deletion_worker_context(org) then raise exception 'Organization deletion is in progress' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_deleting_invitation_attempt() from public,anon,authenticated;
do $$ begin if to_regclass('app_private.invitation_attempts') is not null then
 execute 'create trigger deleting_invitation_attempt before insert or update on app_private.invitation_attempts for each row execute function public.guard_deleting_invitation_attempt()';
end if;end $$;

create function public.start_organization_deletion(p_org uuid,p_actor uuid,p_type text,p_auth uuid,p_name text,p_receipt_hash text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare m public.memberships%rowtype; j app_private.organization_deletions%rowtype; org_name text; linked uuid; busy boolean; nonce uuid:=gen_random_uuid();
begin
 perform app_private.lock_quota(p_org);
 select * into m from public.memberships where organization_id=p_org and user_id=p_actor and user_type=p_type and status='active' for update;
 if not found or m.role<>'owner' or p_type not in ('admin','developer') or not coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='organization.delete'),true) then raise exception 'Deletion requires the active owner' using errcode='42501'; end if;
 if p_type='admin' then select auth_user_id into linked from public.admin_users where id=p_actor and organization_id=p_org;
 else select auth_user_id into linked from public.developers where id=p_actor and organization_id=p_org; end if;
 if linked is distinct from p_auth or not exists(select 1 from auth.users where id=p_auth and raw_app_meta_data->>'organization_id'=p_org::text and raw_app_meta_data->>'app_user_id'=p_actor::text and raw_app_meta_data->>'user_type'=p_type and raw_app_meta_data->>'role'='owner') then raise exception 'Owner identity must be verified' using errcode='42501'; end if;
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

create function public.organization_deletion_status(p_org uuid default null,p_auth uuid default null,p_receipt_hash text default null)
returns jsonb language sql stable security definer set search_path=pg_catalog,app_private as $$
 select jsonb_build_object('id',j.id,'status',j.status,'stage',j.stage,'createdAt',j.created_at,'completedAt',j.completed_at,'lastError',j.last_error,'organizationName',j.organization_name,
 'counts',jsonb_build_object('storagePending',count(*) filter(where i.kind='storage' and i.status='pending'),'storageDone',count(*) filter(where i.kind='storage' and i.status='done'),
 'authPending',count(*) filter(where i.kind='auth' and i.status='pending'),'authDone',count(*) filter(where i.kind='auth' and i.status='done'),'authRetained',count(*) filter(where i.kind='auth' and i.status='retained')))
 from app_private.organization_deletions j left join app_private.organization_deletion_items i on i.job_id=j.id
 where (p_receipt_hash is not null and j.receipt_hash=p_receipt_hash) or (j.organization_id=p_org and j.auth_user_id=p_auth) group by j.id;
$$;
create function public.organization_deletion_active(p_org uuid) returns boolean language sql stable security definer set search_path=pg_catalog,app_private as $$ select app_private.organization_deleting(p_org) $$;
create function public.handle_deletion_billing_event(p_org uuid,p_customer text,p_subscription text,p_reconcile boolean default false)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare j app_private.organization_deletions%rowtype;begin
 select * into j from app_private.organization_deletions where (p_org is null or organization_id=p_org)
 and ((p_customer is not null and stripe_customer_id=p_customer) or (p_subscription is not null and stripe_subscription_id=p_subscription)) for update;
 if not found then return false; end if;
 -- Signed late billable events never resurrect a deleted workspace. Recheck
 -- provider cancellation through the durable worker, even after DB teardown.
 if p_reconcile and j.stage<>'billing' then
  update app_private.organization_deletions set stage='billing',status='pending',lease=null,lease_until=null,next_attempt_at=now(),completed_at=null where id=j.id;
 end if;
 return true;
end $$;
create function public.claim_organization_deletion(p_org uuid default null,p_retry boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare j app_private.organization_deletions%rowtype;begin
 update app_private.organization_deletion_items i set status='pending' from app_private.organization_deletions archived_job,auth.users u
 where i.job_id=archived_job.id and archived_job.status='completed' and i.kind='auth' and i.status='done' and u.id::text=i.resource_id
 and u.raw_app_meta_data->>'organization_id'=archived_job.organization_id::text and u.raw_app_meta_data->>'app_user_id'=i.profile_id::text and u.raw_app_meta_data->>'user_type'=i.profile_type;
 update app_private.organization_deletions archived_job set status='pending',stage='auth',completed_at=null,next_attempt_at=now()
 where status='completed' and exists(select 1 from app_private.organization_deletion_items where job_id=archived_job.id and status='pending');
 select * into j from app_private.organization_deletions where status<>'completed' and (p_org is null or organization_id=p_org)
 and (lease_until is null or lease_until<now()) and (p_retry or next_attempt_at<=now()) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update app_private.organization_deletions set status='processing',lease=gen_random_uuid(),lease_until=now()+interval '10 minutes',attempts=attempts+1 where id=j.id returning * into j;
 return to_jsonb(j)-'receipt_hash';
end $$;
create function public.organization_deletion_items(p_job uuid,p_lease uuid,p_kind text)
returns jsonb language sql stable security definer set search_path=pg_catalog,app_private as $$
 select coalesce(jsonb_agg(to_jsonb(i)),'[]') from (select i.* from app_private.organization_deletion_items i join app_private.organization_deletions j on j.id=i.job_id
 where j.id=p_job and j.lease=p_lease and j.lease_until>now() and j.status='processing' and i.kind=p_kind and i.status='pending'
 order by (i.resource_id=j.auth_user_id::text),i.id limit 25) i;
$$;
create function public.check_deletion_storage_item(p_job uuid,p_lease uuid,p_item uuid)
returns text language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare j app_private.organization_deletions%rowtype;i app_private.organization_deletion_items%rowtype;begin
 select * into j from app_private.organization_deletions where id=p_job and lease=p_lease and lease_until>now() and status='processing';
 if not found then raise exception 'Deletion lease expired' using errcode='42501'; end if;
 select * into i from app_private.organization_deletion_items where id=p_item and job_id=j.id and kind='storage' and status='pending';
 if not found then raise exception 'Deletion item missing'; end if;
 if exists(select 1 from storage.objects where id::text=i.resource_id and bucket_id=i.bucket and name=i.path and app_private.deletion_storage_org(bucket_id,name)=j.organization_id) then return 'present'; end if;
 if not exists(select 1 from storage.objects where id::text=i.resource_id or (bucket_id=i.bucket and name=i.path)) then return 'absent'; end if;
 raise exception 'Storage identity changed; refusing deletion';
end $$;
create function public.check_deletion_auth_identity(p_job uuid,p_lease uuid,p_item uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare j app_private.organization_deletions%rowtype;i app_private.organization_deletion_items%rowtype;n int;begin
 select * into j from app_private.organization_deletions where id=p_job and lease=p_lease and lease_until>now() and status='processing';
 if not found then raise exception 'Deletion lease expired' using errcode='42501'; end if;
 select * into i from app_private.organization_deletion_items where id=p_item and job_id=j.id and kind='auth' and status='pending';
 if not found then return false; end if;
 select count(*) into n from (select id,organization_id,auth_user_id,'admin'::text kind from public.admin_users union all select id,organization_id,auth_user_id,'developer' from public.developers union all select id,organization_id,auth_user_id,'client' from public.clients) p
 where auth_user_id::text=i.resource_id and (organization_id is distinct from j.organization_id or id is distinct from i.profile_id or kind is distinct from i.profile_type);
 if n<>0 or exists(select 1 from public.memberships where user_id=i.profile_id and user_type=i.profile_type and organization_id<>j.organization_id) then return false; end if;
 return exists(select 1 from auth.users where id::text=i.resource_id and raw_app_meta_data->>'organization_id'=j.organization_id::text and raw_app_meta_data->>'app_user_id'=i.profile_id::text and raw_app_meta_data->>'user_type'=i.profile_type and (i.invitation_id is null or raw_app_meta_data->>'invitation_id'=i.invitation_id::text));
end $$;
create function public.finish_organization_deletion_step(p_job uuid,p_lease uuid,p_stage text default null,p_item uuid default null,p_retained boolean default false,p_error boolean default false)
returns boolean language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare j app_private.organization_deletions%rowtype;begin
 select * into j from app_private.organization_deletions where id=p_job and lease=p_lease and lease_until>now() and status='processing' for update;
 if not found then raise exception 'Deletion lease expired' using errcode='42501'; end if;
 if p_item is not null then update app_private.organization_deletion_items set status=case when p_retained then 'retained' else 'done' end where id=p_item and job_id=j.id; end if;
 if p_error then update app_private.organization_deletions set status='retry',last_error='Cleanup could not finish. No completed step will be undone; retry is available.',next_attempt_at=now()+interval '5 minutes',lease=null,lease_until=null where id=j.id;
 elsif p_stage is not null then
  if p_stage not in ('storage','auth','database') then raise exception 'Invalid deletion stage'; end if;
  update app_private.organization_deletions set stage=p_stage,status='pending',lease=null,lease_until=null,next_attempt_at=now(),last_error=null where id=j.id;
 end if;
 return true;
end $$;

-- Accepted proposal provenance survives an explicitly deleted project.
alter table public.project_proposals add column deleted_project_id uuid,add column deleted_project_name text,add column project_deleted_at timestamptz;
create function public.preserve_deleted_proposal_project() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 update public.project_proposals set deleted_project_id=old.id,deleted_project_name=old.name,project_deleted_at=now()
 where project_id=old.id and organization_id=old.organization_id and status='accepted';
 return old;
end $$;
revoke all on function public.preserve_deleted_proposal_project() from public,anon,authenticated;
create trigger preserve_proposal_project before delete on public.projects for each row execute function public.preserve_deleted_proposal_project();
create or replace function public.tg_proposal_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin
 new.updated_at:=now();
 if new.status in ('rejected','needs_info') and nullif(btrim(new.decision_reason),'') is null then raise exception 'A decision needs a reason' using errcode='23514'; end if;
 if new.status='accepted' and new.project_id is null and not (tg_op='UPDATE' and old.status='accepted' and new.deleted_project_id is not null and new.project_deleted_at is not null
 and not exists(select 1 from public.projects where id=new.deleted_project_id)) then raise exception 'An accepted proposal must reference its project or its verified deletion history' using errcode='23514'; end if;
 if tg_op='UPDATE' and old.status='accepted' and new.status<>'accepted' then raise exception 'An accepted proposal cannot be un-accepted' using errcode='23514'; end if;
 if tg_op='UPDATE' and old.project_deleted_at is not null and ((new.deleted_project_id,new.deleted_project_name,new.project_deleted_at) is distinct from (old.deleted_project_id,old.deleted_project_name,old.project_deleted_at) or (new.project_id is distinct from old.project_id and not (old.project_id=old.deleted_project_id and new.project_id is null and not exists(select 1 from public.projects where id=old.deleted_project_id)))) then raise exception 'Deleted project provenance is immutable' using errcode='23514'; end if;
 if new.project_deleted_at is not null and (tg_op='INSERT' or old.project_deleted_at is null) and not (tg_op='UPDATE' and pg_trigger_depth()>1 and old.project_id=new.deleted_project_id and exists(select 1 from public.projects where id=new.deleted_project_id and name=new.deleted_project_name)) then raise exception 'Deletion history is created only by deleting its project' using errcode='23514'; end if;
 if new.status is distinct from old.status and new.status in ('accepted','rejected','needs_info') then new.decided_at:=coalesce(new.decided_at,now()); end if;
 return new;
end $$;
grant select(deleted_project_id,deleted_project_name,project_deleted_at) on public.project_proposals to authenticated;

create function public.finalize_organization_deletion(p_job uuid,p_lease uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare j app_private.organization_deletions%rowtype;t record;remaining int;changed int;passes int:=0;
begin
 select * into j from app_private.organization_deletions where id=p_job and lease=p_lease and lease_until>now() and status='processing' and stage='database' for update;
 if not found then raise exception 'Deletion lease or stage invalid' using errcode='42501'; end if;
 if exists(select 1 from app_private.organization_deletion_items where job_id=j.id and status='pending') then raise exception 'External cleanup is incomplete'; end if;
 if exists(select 1 from storage.objects where app_private.deletion_storage_org(bucket_id,name)=j.organization_id) then raise exception 'Storage cleanup is incomplete'; end if;
 if exists(select 1 from public.organizations where id=j.organization_id) then perform app_private.lock_quota(j.organization_id); end if;perform set_config('app.deletion_lease',p_lease::text,true);
 if to_regclass('app_private.tracking_retention_files') is not null then
  execute 'update app_private.tracking_retention_files r set status=''cancelled'' where organization_id=$1 and status in (''processing'',''failed'') and not exists(select 1 from storage.objects o where o.id::text=r.object_id)' using j.organization_id;
 end if;
 -- Private optional accounting rows are safe to remove only for absent objects.
 if to_regclass('app_private.storage_usage') is not null then
  execute 'delete from app_private.storage_usage u where organization_id=$1 and not exists(select 1 from storage.objects o where o.id::text=u.object_id)' using j.organization_id;
 end if;
 -- Existing legacy tables use SET NULL or no org FK. Delete exact-org rows
 -- explicitly; dependency passes preserve constraint checks and future tables.
 loop
  remaining:=0;changed:=0;passes:=passes+1;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
   and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='organization_id' and not a.attisdropped)
   order by case when c.relname='project_proposals' then 0 when c.relname='memberships' then 2 else 1 end,c.relname loop
   begin
    execute format('delete from public.%I where organization_id=$1',t.relname) using j.organization_id;
    get diagnostics remaining=row_count;changed:=changed+remaining;
   exception when foreign_key_violation then null; end;
  end loop;
  remaining:=0;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
   and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='organization_id' and not a.attisdropped) loop
   execute format('select count(*) from public.%I where organization_id=$1',t.relname) into changed using j.organization_id;remaining:=remaining+changed;
  end loop;
  exit when remaining=0;
  if passes>=20 then raise exception 'Organization dependencies require repair'; end if;
 end loop;
 delete from public.organizations where id=j.organization_id;
 update app_private.organization_deletions set status='completed',stage='completed',completed_at=now(),last_error=null,lease=null,lease_until=null where id=j.id;
 return true;
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('organization_deletion_active','handle_deletion_billing_event','start_organization_deletion','organization_deletion_status','claim_organization_deletion','organization_deletion_items','check_deletion_auth_identity','check_deletion_storage_item','finish_organization_deletion_step','finalize_organization_deletion') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
