\set ON_ERROR_STOP on
\ir automation_retention_deletion_integration.sql
alter table admin_users add column if not exists email text;
alter table developers add column if not exists email text;
alter table clients add column if not exists email text;
alter table memberships add column if not exists email text;
alter table auth.users add column if not exists email text;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
\ir ../../supabase/migrations/20260912043321_production_reserved_profile_provisioning.sql
begin;
do $$ declare org uuid:='96010000-0000-0000-0000-000000000001'; owner uuid:='96010000-0000-0000-0000-000000000011'; owner_auth uuid:='96010000-0000-0000-0000-000000000091'; person uuid:='96010000-0000-0000-0000-000000000021'; client_id uuid:='96010000-0000-0000-0000-000000000022'; job jsonb; retry jsonb; denied boolean; begin
 insert into organizations(id,name) values(org,'Provision tests');
 insert into admin_users(id,organization_id,auth_user_id,email) values(owner,org,owner_auth,'owner@provision.test');
 insert into auth.users(id,email,raw_app_meta_data) values(owner_auth,'owner@provision.test',jsonb_build_object('organization_id',org,'app_user_id',owner,'user_type','admin','role','owner'));
 insert into memberships(organization_id,user_id,user_type,role,status,email) values(org,owner,'admin','owner','active','owner@provision.test');
 insert into developers(id,organization_id,email) values(person,org,'staff@provision.test');
 insert into clients(id,organization_id,email) values(client_id,org,'client@provision.test');
 set local role authenticated;
 denied:=false; begin perform reserve_profile_provision(org,person,'developer','hr','staff@provision.test'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Authenticated reservation bypass'; end if;
 reset role;
 set local role service_role;
 job:=reserve_profile_provision(org,person,'developer','hr','staff@provision.test');
 retry:=reserve_profile_provision(org,person,'developer','hr','staff@provision.test');
 if retry is distinct from job then raise exception 'Retry changed reserved identity'; end if;
 if jsonb_array_length(claim_profile_provisions(1))<>1 then raise exception 'Recovery claim missing'; end if;
 if jsonb_array_length(claim_profile_provisions(1))<>0 then raise exception 'Recovery backoff ignored'; end if;
 reset role;
 denied:=false; begin delete from developers where id=person; exception when object_not_in_prerequisite_state then denied:=true; end;
 if not denied then raise exception 'Deleted pending provision profile'; end if;
 set local role service_role;
 denied:=false; begin perform finish_profile_provision(org,person,'developer','hr','staff@provision.test',(job->>'authUserId')::uuid); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Finalized absent Auth account'; end if;
 denied:=false; begin perform start_organization_deletion(org,owner,'admin',owner_auth,'Provision tests',repeat('f',64)); exception when object_not_in_prerequisite_state then denied:=true; end;
 if not denied then raise exception 'Deletion passed unfinished provider reservation'; end if;
 reset role;
 insert into auth.users(id,email,raw_app_meta_data,email_confirmed_at) values((job->>'authUserId')::uuid,'staff@provision.test',jsonb_build_object('organization_id',org,'app_user_id',person,'user_type','developer','role','hr'),now());
 set local role service_role;
 denied:=false; begin perform finish_profile_provision(org,person,'developer','hr','staff@provision.test',(job->>'authUserId')::uuid); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Finalized Auth without reserved marker'; end if;
 reset role;
 update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('provisioning_id',job->>'reservationId') where id=(job->>'authUserId')::uuid;
 update auth.users set email_confirmed_at=null where id=(job->>'authUserId')::uuid;
 set local role service_role;
 denied:=false; begin perform finish_profile_provision(org,person,'developer','hr','staff@provision.test',(job->>'authUserId')::uuid); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Unconfirmed email finalized'; end if;
 reset role;
 update auth.users set email_confirmed_at=now() where id=(job->>'authUserId')::uuid;
 set local role service_role;
 if not finish_profile_provision(org,person,'developer','hr','staff@provision.test',(job->>'authUserId')::uuid) then raise exception 'Could not finish'; end if;
 if not finish_profile_provision(org,person,'developer','hr','staff@provision.test',(job->>'authUserId')::uuid) then raise exception 'Completion retry failed'; end if;
 reset role;
 if not exists(select 1 from memberships where user_id=person and user_type='developer' and role='hr' and status='active') then raise exception 'No active typed membership'; end if;
 if (select auth_user_id from developers where id=person)::text<>job->>'authUserId' then raise exception 'Missing checked link'; end if;
 -- An existing email cannot create a new reserved identity or a permanent
 -- deletion fence; legacy linkage is an explicit operator repair instead.
 insert into auth.users(id,email,raw_app_meta_data) values('96010000-0000-0000-0000-000000000099','client@provision.test','{}');
 set local role service_role;
 denied:=false; begin perform reserve_profile_provision(org,client_id,'client','client','client@provision.test'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Reserved an already registered email'; end if;
 reset role;
 if (select auth_user_id from clients where id=client_id) is not null or exists(select 1 from app_private.profile_provisioning where profile_id=client_id) then raise exception 'Conflicted email left reservation'; end if;
 -- A different existing link is never replaced with a new reservation.
 update clients set auth_user_id=gen_random_uuid() where id=client_id;
 set local role service_role;
 denied:=false; begin perform reserve_profile_provision(org,client_id,'client','client','client@provision.test'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Overwrote existing Auth link'; end if;
 if (profile_provision_status(org)->0->>'status')<>'completed' then raise exception 'Recovery status incomplete'; end if;
 perform start_organization_deletion(org,owner,'admin',owner_auth,'Provision tests',repeat('f',64));
 denied:=false; begin perform reserve_profile_provision(org,person,'developer','hr','staff@provision.test'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Provisioned deleting organization'; end if;
 reset role;
end $$;
rollback;
