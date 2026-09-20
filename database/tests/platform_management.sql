\set ON_ERROR_STOP on
-- Run after platform_owner_console.sql in an isolated database.
alter table auth.sessions add column if not exists aal text default 'aal1';
create table if not exists auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text);
alter table organizations add column if not exists updated_at timestamptz;
alter table memberships add column if not exists updated_at timestamptz,add column if not exists created_at timestamptz default now();
\if :{?platform_suite_installed}
\else
\ir ../../supabase/migrations/20260920115119_platform_management_access.sql
\endif
begin;
do $$ declare owner_id uuid:=gen_random_uuid(); owner_session uuid:=gen_random_uuid(); support_id uuid:=gen_random_uuid(); support_session uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); member_session uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); profile uuid:=gen_random_uuid(); membership uuid:=gen_random_uuid(); c jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(owner_id,'suite-owner@example.test',now(),'{}'),(support_id,'suite-support@example.test',now(),'{}'),(member_id,'suite-member@example.test',now(),'{}');
 insert into auth.sessions(id,user_id) values(owner_session,owner_id),(support_session,support_id),(member_session,member_id);
 insert into app_private.platform_owners(auth_user_id) values(owner_id);
 insert into app_private.platform_staff(auth_user_id,role,mfa_required) values(support_id,'support',true);
 begin perform app_private.require_platform_permission(support_id,support_session,'members.manage');raise exception 'Missing MFA accepted'; exception when insufficient_privilege then null; end;
 update auth.sessions set aal='aal2' where id=support_session;
 begin perform app_private.require_platform_permission(support_id,support_session,'members.manage');raise exception 'Unenrolled factor accepted'; exception when insufficient_privilege then null; end;
 insert into auth.mfa_factors(user_id,status) values(support_id,'verified');
 perform app_private.require_platform_permission(support_id,support_session,'members.manage');
 c:=public.platform_management_list(owner_id,owner_session,'team');
 if c->>'pageSize'<>'20' or (c->>'total')::int<2 or jsonb_array_length(c->'items')<2 then raise exception 'Team pagination metadata missing';end if;
 begin perform app_private.require_platform_permission(support_id,support_session,'team.manage');raise exception 'Support escalated'; exception when insufficient_privilege then null; end;
 begin perform app_private.require_platform_permission(support_id,support_session,'billing.manage');raise exception 'Support billing escalated'; exception when insufficient_privilege then null; end;
 insert into organizations(id,name,status) values(org,'Managed workspace','active');
 insert into admin_users(id,organization_id,auth_user_id,email) values(profile,org,member_id,'suite-member@example.test');
 insert into memberships(id,organization_id,user_id,user_type,email,role,status) values(membership,org,profile,'admin','suite-member@example.test','owner','active');
 c:=public.select_workspace(member_id,member_session,org,profile,'admin');
 if public.workspace_context(member_id,member_session) is null then raise exception 'Fixture context missing'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'session_id',member_session,'role','authenticated','app_metadata',c)::text,true);
 if public.auth_org() is distinct from org then raise exception 'RLS context missing'; end if;
 perform public.platform_management_mutate(owner_id,owner_session,'organization.status',jsonb_build_object('organizationId',org,'status','suspended'),'Testing organization suspension');
 if public.workspace_context(member_id,member_session) is not null or public.auth_org() is not null then raise exception 'Suspended workspace remained accessible through API/RLS'; end if;
 if (public.platform_organizations_filtered(owner_id,owner_session,'Managed workspace',1,'suspended')->>'total')::int<>1 then raise exception 'Suspended filter failed'; end if;
 perform public.platform_management_mutate(owner_id,owner_session,'organization.status',jsonb_build_object('organizationId',org,'status','active'),'Testing organization reactivation');
 if public.workspace_context(member_id,member_session) is null then raise exception 'Reactivation failed'; end if;
 begin perform public.platform_management_mutate(owner_id,owner_session,'member.status',jsonb_build_object('membershipId',membership,'status','suspended'),'Testing last owner guard');raise exception 'Last owner revoked';exception when check_violation then null;end;
 begin perform public.platform_management_mutate(support_id,support_session,'member.role',jsonb_build_object('membershipId',membership,'role','developer'),'Testing owner guard');raise exception 'Support changed owner';exception when insufficient_privilege then null;end;
 perform public.platform_management_mutate(owner_id,owner_session,'member.sessions',jsonb_build_object('membershipId',membership),'Testing session revocation');
 if public.platform_session_active(member_id,member_session) or public.workspace_context(member_id,member_session) is not null or public.auth_org() is not null then raise exception 'Revoked session survived in API/RLS'; end if;
 member_session:=gen_random_uuid(); insert into auth.sessions(id,user_id) values(member_session,member_id);
 perform public.select_workspace(member_id,member_session,org,profile,'admin');
 if public.workspace_context(member_id,member_session) is null then raise exception 'New login rejected after revocation'; end if;
 begin perform public.platform_management_mutate(owner_id,owner_session,'team.remove',jsonb_build_object('authUserId',owner_id),'Testing self removal');raise exception 'Self removal allowed';exception when insufficient_privilege then null;end;
 if has_function_privilege('authenticated','public.platform_management_mutate(uuid,uuid,text,jsonb,text)','execute') or has_function_privilege('anon','public.platform_access(uuid,uuid)','execute') then raise exception 'RPC leaked';end if;
 if (select count(*) from app_private.platform_audit where actor_id=owner_id)<3 then raise exception 'Audit missing';end if;
end $$;
rollback;
