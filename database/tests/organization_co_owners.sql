\set ON_ERROR_STOP on
\ir shared_account_billing.sql
alter table invitations add column invited_by uuid;
create function app_private.plan_feature(p_org uuid,p_feature text) returns boolean
language sql stable security definer set search_path=pg_catalog,public,app_private as $$
 select app_private.org_unlocked(p_org) and coalesce((select features->p_feature='true'::jsonb from billing_plans where code=app_private.effective_plan(p_org)),false)
$$;
create table role_permissions(role text,resource text,action text,allowed boolean);
create function public.auth_role() returns text language sql stable as $$select auth.jwt()->'app_metadata'->>'role'$$;
create function public.auth_app_user_id() returns uuid language sql stable as $$select (auth.jwt()->'app_metadata'->>'app_user_id')::uuid$$;
create function public.auth_is_client() returns boolean language sql stable as $$select coalesce(auth.jwt()->'app_metadata'->>'user_type'='client',false)$$;
create function public.auth_override(text) returns boolean language sql stable as $$select null::boolean$$;
create function app_private.deletion_worker_context(uuid) returns boolean language sql stable as $$select false$$;
\ir ../../supabase/migrations/20260911063616_production_invitation_transactions.sql
\ir ../../supabase/migrations/20260911074242_production_invitation_authority.sql
-- A real legacy admin membership/profile/claim to migrate, independent of signup owner.
do $$ declare org uuid; pid uuid:=gen_random_uuid(); uid uuid:=gen_random_uuid(); begin
 select id into org from organizations where name='Company';
 insert into auth.users(id,email,raw_app_meta_data) values(uid,'legacy-owner@example.test',jsonb_build_object('organization_id',org,'app_user_id',pid,'user_type','admin','role','admin'));
 insert into admin_users(id,organization_id,full_name,email,company,role,is_verified,auth_user_id) values(pid,org,'Legacy admin','legacy-owner@example.test','Company','admin',true,uid);
 insert into memberships(organization_id,user_id,user_type,email,role,status) values(org,pid,'admin','legacy-owner@example.test','admin','active');
end $$;
\ir ../../supabase/migrations/20260921175040_organization_co_owners.sql

do $$ declare org uuid; inviter uuid; invitation uuid:=gen_random_uuid(); claim uuid:=gen_random_uuid(); reserved jsonb; result jsonb; last_owner uuid; begin
 select organization_id,user_id into org,inviter from memberships where email='legacy-owner@example.test';
 if not exists(select 1 from memberships where user_id=inviter and role='owner') then raise exception 'Legacy admin not converted'; end if;
 if not exists(select 1 from auth.users where email='legacy-owner@example.test' and raw_app_meta_data->>'role'='owner' and raw_app_meta_data->>'user_type'='admin') then raise exception 'Claims not converted safely'; end if;
 if public.role_rank('admin') is not null then raise exception 'Retired role still valid'; end if;
 perform expect_rejected(format('update memberships set role=''admin'' where user_id=%L',inviter),'new row for relation "memberships" violates check constraint');
 update billing_plans set limits=limits||'{"employees":100,"developers":100}'::jsonb;
 insert into invitations(id,organization_id,email,role,invited_by) values(invitation,org,'co-owner@example.test','owner',inviter);
 reserved:=claim_invitation(invitation,claim);
 insert into auth.users(id,email,raw_app_meta_data) values((reserved->>'auth_user_id')::uuid,'co-owner@example.test',jsonb_build_object('invitation_id',invitation,'organization_id',org,'app_user_id',reserved->>'profile_id','user_type','admin','role','owner'));
 result:=finish_invitation(invitation,claim,'Co-owner','test-v1');
 if result->>'role'<>'owner' or result->>'userType'<>'admin' then raise exception 'Wrong owner profile'; end if;
 if not exists(select 1 from memberships where user_id=(reserved->>'profile_id')::uuid and role='owner' and status='active') then raise exception 'Missing co-owner membership'; end if;
 -- A revoked inviter cannot confer ownership through an older token.
 invitation:=gen_random_uuid(); claim:=gen_random_uuid();
 insert into invitations(id,organization_id,email,role,invited_by) values(invitation,org,'stale-owner@example.test','owner',inviter);
 reserved:=claim_invitation(invitation,claim);
 insert into auth.users(id,email,raw_app_meta_data) values((reserved->>'auth_user_id')::uuid,'stale-owner@example.test',jsonb_build_object('invitation_id',invitation,'organization_id',org,'app_user_id',reserved->>'profile_id','user_type','admin','role','owner'));
 update memberships set role='manager' where user_id=inviter;
 perform expect_rejected(format('select finish_invitation(%L,%L,''Stale'',''test-v1'')',invitation,claim),'OWNER_INVITER_REQUIRED');
 perform expect_rejected(format('insert into invitations(organization_id,email,role,invited_by) values(%L,''bad-owner@example.test'',''owner'',%L)',org,inviter),'OWNER_INVITER_REQUIRED');
 -- Other owners can be removed; no path may remove the last active one.
 select id into last_owner from memberships where organization_id=org and role='owner' and status='active' order by id limit 1;
 delete from memberships where organization_id=org and role='owner' and id<>last_owner;
 perform expect_rejected(format('update memberships set role=''manager'' where id=%L',last_owner),'LAST_ORGANIZATION_OWNER');
 perform expect_rejected(format('update memberships set status=''suspended'' where id=%L',last_owner),'LAST_ORGANIZATION_OWNER');
 perform expect_rejected(format('update memberships set deletion_blocked=true where id=%L',last_owner),'LAST_ORGANIZATION_OWNER');
 perform expect_rejected(format('delete from memberships where id=%L',last_owner),'LAST_ORGANIZATION_OWNER');
 if has_function_privilege('authenticated','public.finish_invitation(uuid,uuid,text,text,inet)','execute') then raise exception 'Acceptance RPC exposed'; end if;
 if has_function_privilege('anon','public.auth_can_invite_role(text)','execute') then raise exception 'Invitation authorization exposed'; end if;
end $$;
select 'Organization co-owner conversion, acceptance, stale inviter and last-owner checks passed' as result;
