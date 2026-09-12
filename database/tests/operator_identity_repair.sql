\set ON_ERROR_STOP on
\ir current_profile_authority.sql
alter table auth.users add column email text, add column email_confirmed_at timestamptz;
alter table admin_users add column email text;
alter table developers add column email text, add column status text default 'active';
alter table clients add column email text;
alter table memberships add column email text;
create table invitations(id uuid primary key,email text,status text);
create table app_private.invitation_attempts(invitation_id uuid,profile_id uuid,auth_user_id uuid);
\ir ../../supabase/migrations/20260912043321_production_reserved_profile_provisioning.sql
\ir ../../supabase/migrations/20260912043604_production_operator_identity_repair.sql

create function assert_repair_refused(p_org uuid,p_profile uuid,p_type text,p_auth uuid,p_reason text,p_null_org boolean default false) returns void language plpgsql as $$
declare result jsonb; begin
 result:=public.operator_repair_profile_identity(p_org,p_profile,p_type,p_auth,false,p_null_org);
 if result->>'eligible'<>'false' or not (result->'failures' ? p_reason) then raise exception 'Unexpected preview % expected %',result,p_reason; end if;
 begin
  perform public.operator_repair_profile_identity(p_org,p_profile,p_type,p_auth,true,p_null_org,'REPAIR VERIFIED EXISTING IDENTITY','offline test verification');
  raise exception 'Unsafe repair accepted';
 exception when insufficient_privilege then null; end;
end $$;

do $$ declare org uuid:='99000000-0000-0000-0000-000000000001'; other_org uuid:='99000000-0000-0000-0000-000000000002';
 profile uuid:='99000000-0000-0000-0000-000000000011'; uid uuid:='99000000-0000-0000-0000-000000000091'; result jsonb; before_count int;
begin
 insert into organizations(id,name) values(org,'Repair organization'),(other_org,'Other organization');
 insert into developers(id,organization_id,auth_user_id,email) values(profile,org,null,' Person@example.test ');
 insert into memberships(organization_id,user_id,user_type,role,status,email) values(org,profile,'developer','developer','active','person@example.test');
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(uid,'PERSON@example.test',now(),
 jsonb_build_object('organization_id',org,'app_user_id',profile,'user_type','developer','role','developer'));
 set local role authenticated;
 begin perform public.operator_repair_profile_identity(org,profile,'developer',uid); raise exception 'Authenticated caller reached operator repair'; exception when insufficient_privilege then null; end;
 reset role;
 set local role anon;
 begin perform public.operator_repair_profile_identity(org,profile,'developer',uid); raise exception 'Anon reached operator repair'; exception when insufficient_privilege then null; end;
 reset role;
 result:=public.operator_repair_profile_identity(org,profile,'developer',uid);
 if result->>'eligible'<>'true' or (select auth_user_id from developers where id=profile) is not null or exists(select 1 from app_private.identity_repair_audit) then raise exception 'Preview mutated state or rejected valid proof'; end if;
 begin perform public.operator_repair_profile_identity(org,profile,'developer',uid,null); raise exception 'Null apply flag accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.operator_repair_profile_identity(org,profile,'developer',uid,true); raise exception 'Missing acknowledgment accepted'; exception when invalid_parameter_value then null; end;
 perform assert_repair_refused(org,gen_random_uuid(),'developer',uid,'profile_missing');
 update developers set auth_user_id=gen_random_uuid() where id=profile;
 perform assert_repair_refused(org,profile,'developer',uid,'profile_link_conflict');
 update developers set auth_user_id=null,organization_id=other_org where id=profile;
 perform assert_repair_refused(org,profile,'developer',uid,'profile_organization_conflict');
 update developers set organization_id=null where id=profile;
 perform assert_repair_refused(org,profile,'developer',uid,'null_organization_opt_in_required');
 update developers set organization_id=org where id=profile;
 update auth.users set email_confirmed_at=null where id=uid;
 perform assert_repair_refused(org,profile,'developer',uid,'confirmed_auth_email_required');
 update auth.users set email_confirmed_at=now(),banned_until=now()+interval '1 day' where id=uid;
 perform assert_repair_refused(org,profile,'developer',uid,'auth_user_unavailable');
 update auth.users set banned_until=null,raw_app_meta_data=jsonb_set(raw_app_meta_data,'{app_user_id}',to_jsonb(gen_random_uuid())) where id=uid;
 perform assert_repair_refused(org,profile,'developer',uid,'trusted_metadata_disagrees');
 update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{app_user_id}',to_jsonb(profile)) where id=uid;
 insert into admin_users(id,organization_id,auth_user_id,email) values(profile,org,uid,'someone-else@example.test');
 perform assert_repair_refused(org,profile,'developer',uid,'profile_identity_ambiguous');
 delete from admin_users where id=profile;
 update developers set email='wrong@example.test' where id=profile;
 perform assert_repair_refused(org,profile,'developer',uid,'verified_emails_disagree');
 update developers set email='person@example.test',status='suspended' where id=profile;
 perform assert_repair_refused(org,profile,'developer',uid,'profile_inactive');
 update developers set status='active' where id=profile;
 insert into app_private.invitation_attempts(profile_id,auth_user_id) values(profile,uid);
 perform assert_repair_refused(org,profile,'developer',uid,'reserved_identity_requires_recovery');
 delete from app_private.invitation_attempts;
 insert into app_private.profile_provisioning(organization_id,profile_id,user_type,role,email,auth_user_id) values(org,profile,'developer','developer','person@example.test',uid);
 perform assert_repair_refused(org,profile,'developer',uid,'reserved_identity_requires_recovery');
 delete from app_private.profile_provisioning;
 insert into invitations(id,email,status) values(gen_random_uuid(),'person@example.test','pending');
 perform assert_repair_refused(org,profile,'developer',uid,'reserved_identity_requires_recovery');
 delete from invitations;
 insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'person@example.test',now());
 perform assert_repair_refused(org,profile,'developer',uid,'auth_email_ambiguous');
 delete from auth.users where id<>uid and lower(email)='person@example.test';
 insert into app_private.organization_deletions(organization_id,organization_name,actor_id,actor_type,auth_user_id,receipt_hash)
 values(org,'Repair organization',profile,'developer',uid,'operator-test-receipt');
 perform assert_repair_refused(org,profile,'developer',uid,'organization_deleting');
 delete from app_private.organization_deletions where organization_id=org;
 set local role service_role;
 result:=public.operator_repair_profile_identity(org,profile,'developer',uid,true,false,'REPAIR VERIFIED EXISTING IDENTITY','offline verified support case');
 reset role;
 if result->>'applied'<>'true' or (select auth_user_id from developers where id=profile)<>uid or (select count(*) from app_private.identity_repair_audit)<>1 then raise exception 'Verified link/audit not committed'; end if;
 perform assert_repair_refused(org,profile,'developer',uid,'identity_already_linked');
 -- Explicit null-org recovery may preserve the already correct Auth link.
 update developers set organization_id=null where id=profile;
 result:=public.operator_repair_profile_identity(org,profile,'developer',uid,true,true,'REPAIR VERIFIED EXISTING IDENTITY','offline verified null org recovery');
 if result->>'repairedLink'<>'false' or result->>'repairedOrganization'<>'true' or (select organization_id from developers where id=profile)<>org then raise exception 'Null-org recovery changed wrong field'; end if;
end $$;

-- Audit write failure must roll back the repaired profile in the same transaction.
create function reject_identity_audit() returns trigger language plpgsql as $$ begin raise exception 'Injected audit failure' using errcode='23514'; end $$;
create trigger reject_identity_audit before insert on app_private.identity_repair_audit for each row execute function reject_identity_audit();
do $$ declare org uuid:='99000000-0000-0000-0000-000000000001'; profile uuid:='99000000-0000-0000-0000-000000000011'; uid uuid:='99000000-0000-0000-0000-000000000091'; begin
 update developers set auth_user_id=null where id=profile;
 begin perform public.operator_repair_profile_identity(org,profile,'developer',uid,true,false,'REPAIR VERIFIED EXISTING IDENTITY','offline atomic failure test'); raise exception 'Injected audit failure ignored'; exception when check_violation then null; end;
 if (select auth_user_id from developers where id=profile) is not null then raise exception 'Audit failure retained profile mutation'; end if;
end $$;
drop trigger reject_identity_audit on app_private.identity_repair_audit;
do $$ declare kind text; rel text; org uuid; profile uuid; uid uuid; role_name text; result jsonb; begin
 foreach kind in array array['admin','client'] loop
  org:=gen_random_uuid(); profile:=gen_random_uuid(); uid:=gen_random_uuid();
  rel:=case when kind='admin' then 'admin_users' else 'clients' end;
  role_name:=case when kind='admin' then 'owner' else 'client' end;
  insert into organizations(id,name) values(org,'Typed repair');
  execute format('insert into %I(id,organization_id,email) values($1,$2,$3)',rel) using profile,org,kind||'@repair.test';
  insert into memberships(organization_id,user_id,user_type,role,status,email) values(org,profile,kind,role_name,'active',kind||'@repair.test');
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(uid,kind||'@repair.test',now(),jsonb_build_object('organization_id',org,'app_user_id',profile,'user_type',kind,'role',role_name));
  result:=public.operator_repair_profile_identity(org,profile,kind,uid,true,false,'REPAIR VERIFIED EXISTING IDENTITY','typed identity verification');
  if result->>'applied'<>'true' then raise exception 'Typed identity repair failed'; end if;
 end loop;
end $$;
select 'Operator identity repair SQL passed' as result;
