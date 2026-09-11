-- Real proposal/roster/notification integration plus lifecycle. External provider
-- deletion is represented only by ledger acknowledgements; no provider is called.
\ir proposal_decision_transaction.sql
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.auth',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt',true),''),'{}')::jsonb $$;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb);
create function role_rank(text) returns integer language sql immutable as $$ select case $1 when 'owner' then 1 when 'admin' then 2 when 'developer' then 6 when 'client' then 9 end $$;
alter table organizations add column name text;
alter table clients add column auth_user_id uuid;
create table admin_users(id uuid primary key,organization_id uuid,auth_user_id uuid);
create table developers(id uuid primary key,organization_id uuid,auth_user_id uuid);
create table organization_subscriptions(organization_id uuid primary key,stripe_customer_id text,stripe_subscription_id text);
create table screenshots(id uuid primary key default gen_random_uuid(),organization_id uuid,storage_path text);
create table legacy_unconstrained_data(id uuid primary key default gen_random_uuid(),organization_id uuid,value text);
create schema storage;
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text);
create table invitations(id uuid primary key,organization_id uuid,role text);
create table app_private.invitation_attempts(invitation_id uuid primary key references invitations on delete cascade,auth_user_id uuid,profile_id uuid,completed_at timestamptz,lease_until timestamptz);
\ir ../../supabase/migrations/20260911180815_production_organization_deletion_lifecycle.sql
grant all on all tables in schema public to service_role;
grant update on legacy_unconstrained_data to authenticated;
grant select on legacy_unconstrained_data to authenticated;
create function org_deletion_failure() returns trigger language plpgsql as $$ begin
 if current_setting('test.deletion_failure',true)='yes' then raise exception 'ORG_TEST_FAILURE'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger org_deletion_failure before insert on app_private.organization_deletion_items for each row execute function org_deletion_failure();
create trigger org_deletion_failure before delete on legacy_unconstrained_data for each row execute function org_deletion_failure();

begin;
do $$ declare org uuid:=gen_random_uuid(); foreign_org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); actor_auth uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); shared_auth uuid:=gen_random_uuid(); job uuid; claimed jsonb; item jsonb; project uuid; proposal uuid; counts jsonb;
begin
 insert into organizations(id,name) values(org,'Delete me'),(foreign_org,'Keep me');
 insert into memberships(organization_id,user_id,user_type,role,status) values(org,actor,'admin','owner','active'),(org,other,'developer','developer','active');
 insert into admin_users values(actor,org,actor_auth);
 insert into developers values(other,org,shared_auth),(gen_random_uuid(),foreign_org,shared_auth);
 insert into auth.users values(actor_auth,jsonb_build_object('organization_id',org,'app_user_id',actor,'user_type','admin','role','owner')),
 (shared_auth,jsonb_build_object('organization_id',org,'app_user_id',other,'user_type','developer','role','developer'));
 insert into legacy_unconstrained_data(organization_id,value) values(org,'delete'),(foreign_org,'keep');
 insert into storage.objects(bucket_id,name) values('monitoring',org::text||'/'||other::text||'/image.png'),('org-files',foreign_org::text||'/foreign.png');
 -- Mutable screenshot references cannot turn a foreign object into own data.
 insert into screenshots(organization_id,storage_path) values(org,'untrusted-legacy.png');
 insert into storage.objects(bucket_id,name) values('screenshots','untrusted-legacy.png');
 set local role service_role;
 perform proposal_denied(format('select start_organization_deletion(%L,%L,''admin'',%L,''Delete me'',%L)',org,actor,actor_auth,repeat('a',64)),'ambiguous storage');
 reset role;
 delete from screenshots where storage_path='untrusted-legacy.png';delete from storage.objects where name='untrusted-legacy.png';
 perform set_config('test.deletion_failure','yes',true);
 set local role service_role;
 perform proposal_denied(format('select start_organization_deletion(%L,%L,''admin'',%L,''Delete me'',%L)',org,actor,actor_auth,repeat('a',64)),'ORG_TEST_FAILURE');
 reset role;perform set_config('test.deletion_failure','no',true);
 if exists(select 1 from memberships where organization_id=org and deletion_blocked) or app_private.organization_deleting(org) then raise exception 'Failed start leaked freeze/job'; end if;
 insert into user_permissions(membership_id,permission_key,allowed) select id,'organization.delete',false from memberships where user_id=actor;
 set local role service_role;
 perform proposal_denied(format('select start_organization_deletion(%L,%L,''admin'',%L,''Delete me'',%L)',org,actor,actor_auth,repeat('a',64)),'active owner');
 reset role;delete from user_permissions;
 update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('organization_id',foreign_org) where id=actor_auth;
 set local role service_role;
 perform proposal_denied(format('select start_organization_deletion(%L,%L,''admin'',%L,''Delete me'',%L)',org,actor,actor_auth,repeat('a',64)),'identity must be verified');
 reset role;update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('organization_id',org) where id=actor_auth;
 set local role authenticated;
 perform proposal_denied(format('select start_organization_deletion(%L,%L,''admin'',%L,''Delete me'',%L)',org,actor,actor_auth,repeat('a',64)),'permission denied');
 reset role;
 set local role service_role;
 perform proposal_denied(format('select start_organization_deletion(%L,%L,''developer'',%L,''Delete me'',%L)',org,actor,actor_auth,repeat('a',64)),'active owner');
 perform proposal_denied(format('select start_organization_deletion(%L,%L,''admin'',%L,''wrong name'',%L)',org,actor,actor_auth,repeat('a',64)),'exact organization name');
 reset role;
 -- Accepted project DELETE preserves public provenance through the real FK.
 insert into clients(id,organization_id,status) values(gen_random_uuid(),org,'active');
 insert into project_proposals(organization_id,client_id,title,description) select org,id,'Retain history','Scope' from clients where organization_id=org limit 1 returning id into proposal;
 insert into projects(organization_id,name,proposal_id) values(org,'Deleted accepted project',proposal) returning id into project;
 update project_proposals set status='accepted',project_id=project where id=proposal;
 delete from projects where id=project;
 if not exists(select 1 from project_proposals where id=proposal and status='accepted' and project_id is null and deleted_project_id=project and deleted_project_name='Deleted accepted project' and project_deleted_at is not null) then raise exception 'Accepted project history lost'; end if;
 perform proposal_denied(format('update project_proposals set deleted_project_name=''forged'' where id=%L',proposal),'immutable');
 set local role service_role;
 job:=start_organization_deletion(org,actor,'admin',actor_auth,'Delete me',repeat('a',64));
 if start_organization_deletion(org,actor,'admin',actor_auth,'Delete me',repeat('b',64))<>job then raise exception 'Start retry duplicated job'; end if;
 perform set_config('test.auth',actor_auth::text,true);perform set_config('test.jwt',jsonb_build_object('app_metadata',jsonb_build_object('organization_id',org,'app_user_id',actor,'user_type','admin','role','owner'))::text,true);
 if public.auth_org() is not null then raise exception 'Old JWT retained tenant read access'; end if;
 if organization_deletion_status(null,null,repeat('a',64)) is not null then raise exception 'Old receipt remained after rotation'; end if;
 if organization_deletion_status(null,null,repeat('b',64)) is null then raise exception 'Receipt unavailable'; end if;
 perform proposal_denied(format('update organizations set name=''unsafe'' where id=%L',org),'deletion is in progress');
 perform proposal_denied(format('insert into legacy_unconstrained_data(organization_id,value) values(%L,''unsafe'')',org),'deletion is in progress');
 claimed:=claim_organization_deletion(org,true);
 if claim_organization_deletion(org,true) is not null then raise exception 'Lease duplicated'; end if;
 perform set_config('app.deletion_lease',claimed->>'lease',true);
 set local role authenticated;
 perform proposal_denied(format('update legacy_unconstrained_data set value=''forged worker'' where organization_id=%L',org),'deletion is in progress');
 reset role;set local role service_role;perform set_config('app.deletion_lease','',true);
 perform proposal_denied(format('select finalize_organization_deletion(%L,%L)',job,claimed->>'lease'),'stage invalid');
 perform finish_organization_deletion_step(job,(claimed->>'lease')::uuid,'storage');
 claimed:=claim_organization_deletion(org,true);
 item:=organization_deletion_items(job,(claimed->>'lease')::uuid,'storage')->0;
 if check_deletion_storage_item(job,(claimed->>'lease')::uuid,(item->>'id')::uuid)<>'present' then raise exception 'Owned storage not captured'; end if;
 reset role;
 -- Simulate successful Storage API metadata cleanup only in isolated fixture.
 delete from storage.objects where id::text=item->>'resource_id';
 set local role service_role;
 if check_deletion_storage_item(job,(claimed->>'lease')::uuid,(item->>'id')::uuid)<>'absent' then raise exception 'Absence unverified'; end if;
 perform finish_organization_deletion_step(job,(claimed->>'lease')::uuid,null,(item->>'id')::uuid);
 perform finish_organization_deletion_step(job,(claimed->>'lease')::uuid,'auth');
 claimed:=claim_organization_deletion(org,true);
 for item in select * from jsonb_array_elements(organization_deletion_items(job,(claimed->>'lease')::uuid,'auth')) loop
  if item->>'resource_id'=shared_auth::text then
   if check_deletion_auth_identity(job,(claimed->>'lease')::uuid,(item->>'id')::uuid) then raise exception 'Shared Auth identity was deletable'; end if;
   perform finish_organization_deletion_step(job,(claimed->>'lease')::uuid,null,(item->>'id')::uuid,true);
  else
   if not check_deletion_auth_identity(job,(claimed->>'lease')::uuid,(item->>'id')::uuid) then raise exception 'Exact linked owner not eligible'; end if;
   perform finish_organization_deletion_step(job,(claimed->>'lease')::uuid,null,(item->>'id')::uuid);
  end if;
 end loop;
 perform finish_organization_deletion_step(job,(claimed->>'lease')::uuid,'database');
 claimed:=claim_organization_deletion(org,true);
 perform set_config('test.deletion_failure','yes',true);
 perform proposal_denied(format('select finalize_organization_deletion(%L,%L)',job,claimed->>'lease'),'ORG_TEST_FAILURE');
 if not exists(select 1 from organizations where id=org) or not exists(select 1 from memberships where organization_id=org) then raise exception 'Failed DB teardown partially committed'; end if;
 perform set_config('test.deletion_failure','no',true);
 perform finish_organization_deletion_step(job,(claimed->>'lease')::uuid,null,null,false,true);
 claimed:=claim_organization_deletion(org,true);
 perform finalize_organization_deletion(job,(claimed->>'lease')::uuid);
 counts:=organization_deletion_status(null,null,repeat('b',64));
 if counts->>'status'<>'completed' or (counts->'counts'->>'authRetained')::int<>1 then raise exception 'Completion receipt missing'; end if;
 reset role;
 if exists(select 1 from organizations where id=org) or exists(select 1 from legacy_unconstrained_data where organization_id=org) then raise exception 'Tenant teardown incomplete'; end if;
 if not exists(select 1 from organizations where id=foreign_org) or not exists(select 1 from developers where organization_id=foreign_org) or not exists(select 1 from storage.objects where name=foreign_org::text||'/foreign.png') then raise exception 'Foreign tenant changed'; end if;
end $$;
rollback;

begin;
do $$ declare org uuid:=gen_random_uuid();actor uuid:=gen_random_uuid();owner_auth uuid:=gen_random_uuid();invite uuid:=gen_random_uuid();reserved uuid:=gen_random_uuid();profile uuid:=gen_random_uuid();job uuid;j jsonb;i jsonb;begin
 insert into organizations(id,name) values(org,'Invitation cleanup');
 insert into memberships(organization_id,user_id,user_type,role,status) values(org,actor,'admin','owner','active');
 insert into admin_users values(actor,org,owner_auth);
 insert into auth.users values(owner_auth,jsonb_build_object('organization_id',org,'app_user_id',actor,'user_type','admin','role','owner')),
 (reserved,jsonb_build_object('organization_id',org,'app_user_id',profile,'user_type','developer','role','developer','invitation_id',invite));
 insert into invitations values(invite,org,'developer');insert into app_private.invitation_attempts values(invite,reserved,profile,null,now()+interval '1 minute');
 set local role service_role;
 perform proposal_denied(format('select start_organization_deletion(%L,%L,''admin'',%L,''Invitation cleanup'',%L)',org,actor,owner_auth,repeat('c',64)),'acceptance is in progress');
 reset role;update app_private.invitation_attempts set lease_until=now()-interval '1 minute';
 set local role service_role;
 job:=start_organization_deletion(org,actor,'admin',owner_auth,'Invitation cleanup',repeat('c',64));j:=claim_organization_deletion(org,true);
 for i in select * from jsonb_array_elements(organization_deletion_items(job,(j->>'lease')::uuid,'auth')) loop
  if i->>'resource_id'=reserved::text then
   if i->>'invitation_id'<>invite::text or not check_deletion_auth_identity(job,(j->>'lease')::uuid,(i->>'id')::uuid) then raise exception 'Reserved Auth account not captured safely'; end if;
  end if;
 end loop;
 reset role;
 if (select count(*) from app_private.organization_deletion_items where job_id=job and kind='auth')<>2 then raise exception 'Reserved Auth identity escaped inventory'; end if;
 perform proposal_denied(format('update app_private.invitation_attempts set lease_until=now()+interval ''5 minutes'' where invitation_id=%L',invite),'deletion is in progress');
end $$;
rollback;
