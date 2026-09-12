\ir current_profile_authority.sql
alter table organization_subscriptions add column plan_code text,add column status text,add column trial_end timestamptz,add column grace_period_ends_at timestamptz;
-- Exact org_unlocked definition from production quota enforcement.
create or replace function app_private.org_unlocked(p_org uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select p_org is not null and coalesce((select case
 when s.plan_code='free' then true
 when s.status='trialing' then s.trial_end is null or now()<=s.trial_end
 when s.status='past_due' then s.grace_period_ends_at is null or now()<=s.grace_period_ends_at
 when s.status='unpaid' then false else true end
 from public.organization_subscriptions s where s.organization_id=p_org),true);
$$;
\ir ../../supabase/migrations/20260912083144_production_organization_idle_reminder_policy.sql
create function idle_expect_rejected(command text, expected text) returns void language plpgsql as $$
begin
 begin execute command; exception when others then
 if sqlerrm like expected || '%' then return; end if; raise; end;
 raise exception 'Expected %, succeeded %',expected,command;
end $$;
begin;
do $$
declare org uuid:='99000000-0000-0000-0000-000000000001'; other_org uuid:='99000000-0000-0000-0000-000000000002';
 app uuid:='99000000-0000-0000-0000-000000000011'; uid uuid:='99000000-0000-0000-0000-000000000091';
 claims jsonb; policy jsonb; membership uuid; kind text; role_name text;
begin
 insert into organizations(id,name) values(org,'Idle policy'),(other_org,'Other tenant');
 insert into admin_users values(app,org,uid);
 insert into developers values(app,org,uid);
 insert into clients values(app,org,uid);
 insert into memberships(organization_id,user_id,user_type,role,status) values(org,app,'admin','owner','active') returning id into membership;
 claims:=jsonb_build_object('organization_id',org,'app_user_id',app,'user_type','admin','role','owner');
 insert into auth.users(id,raw_app_meta_data) values(uid,claims);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'app_metadata',claims)::text,true);
 if has_table_privilege('authenticated','organization_idle_reminder_policies','INSERT')
  or has_table_privilege('authenticated','organization_idle_reminder_policies','UPDATE')
  or has_table_privilege('authenticated','organization_idle_reminder_policies','DELETE')
  or has_function_privilege('anon','set_idle_reminder_policy(boolean,integer)','EXECUTE')
  or has_function_privilege('anon','get_idle_reminder_policy()','EXECUTE') then raise exception 'Unsafe grants'; end if;
 set local role authenticated;
 policy:=get_idle_reminder_policy();
 if policy->>'enabled'<>'false' or policy->>'threshold_seconds'<>'300' or policy->>'can_manage'<>'true' then raise exception 'Defaults incorrect %',policy; end if;
 perform idle_expect_rejected('select set_idle_reminder_policy(null,300)','IDLE_REMINDER_POLICY_INVALID');
 perform idle_expect_rejected('select set_idle_reminder_policy(true,null)','IDLE_REMINDER_POLICY_INVALID');
 perform idle_expect_rejected('select set_idle_reminder_policy(true,59)','IDLE_REMINDER_POLICY_INVALID');
 perform idle_expect_rejected('select set_idle_reminder_policy(true,3601)','IDLE_REMINDER_POLICY_INVALID');
 policy:=set_idle_reminder_policy(true,60);
 if policy->>'enabled'<>'true' or policy->>'threshold_seconds'<>'60' then raise exception 'Save failed'; end if;
 perform set_idle_reminder_policy(false,3600);
 perform idle_expect_rejected('update organization_idle_reminder_policies set enabled=true','permission denied');
 reset role;
 insert into organization_idle_reminder_policies(organization_id,enabled) values(other_org,true);
 set local role authenticated;
 if (select count(*) from organization_idle_reminder_policies)<>1 then raise exception 'Cross tenant read'; end if;
 reset role;
 -- Real stored permission override denies even the valid owner.
 insert into user_permissions(membership_id,permission_key,allowed) values(membership,'organization.settings',false);
 set local role authenticated;
 perform idle_expect_rejected('select set_idle_reminder_policy(true,300)','IDLE_REMINDER_POLICY_FORBIDDEN');
 reset role;
 update user_permissions set permission_key='organization.manage' where membership_id=membership;
 set local role authenticated;
 perform idle_expect_rejected('select set_idle_reminder_policy(true,300)','IDLE_REMINDER_POLICY_FORBIDDEN');
 reset role;
 delete from user_permissions where membership_id=membership;
 -- A detached profile and stale role cannot access even the read RPC.
 update admin_users set auth_user_id=null where id=app;
 set local role authenticated;
 perform idle_expect_rejected('select get_idle_reminder_policy()','IDLE_REMINDER_POLICY_UNAUTHORIZED');
 perform idle_expect_rejected('select set_idle_reminder_policy(true,300)','IDLE_REMINDER_POLICY_FORBIDDEN');
 reset role;
 update admin_users set auth_user_id=uid where id=app;
 update memberships set role='admin' where id=membership;
 set local role authenticated;
 perform idle_expect_rejected('select get_idle_reminder_policy()','IDLE_REMINDER_POLICY_UNAUTHORIZED');
 reset role;
 -- Updating both authoritative Auth metadata and membership restores admin access.
 claims:=jsonb_set(claims,'{role}','"admin"');
 update auth.users set raw_app_meta_data=claims where id=uid;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'app_metadata',claims)::text,true);
 set local role authenticated;
 perform set_idle_reminder_policy(true,300);
 reset role;
 update memberships set role='owner' where id=membership;
 claims:=jsonb_set(claims,'{role}','"owner"');
 update auth.users set raw_app_meta_data=claims where id=uid;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'app_metadata',claims)::text,true);
 insert into organization_subscriptions(organization_id,plan_code,status) values(org,'professional','unpaid');
 set local role authenticated;
 perform set_idle_reminder_policy(false,300);
 perform idle_expect_rejected('select set_idle_reminder_policy(true,300)','BILLING_LOCKED');
 reset role;
 -- Typed staff/client remain read-only even with an explicit manage grant.
 foreach kind in array array['developer','client'] loop
  role_name:=case when kind='client' then 'client' else 'developer' end;
  insert into memberships(organization_id,user_id,user_type,role,status) values(org,app,kind,role_name,'active') returning id into membership;
  insert into user_permissions(membership_id,permission_key,allowed) values(membership,'organization.manage',true);
  claims:=jsonb_build_object('organization_id',org,'app_user_id',app,'user_type',kind,'role',role_name);
  update auth.users set raw_app_meta_data=claims where id=uid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'app_metadata',claims)::text,true);
  set local role authenticated;
  policy:=get_idle_reminder_policy();
  if policy->>'can_manage'<>'false' or policy->>'threshold_seconds'<>'300' then raise exception 'Staff read policy incorrect'; end if;
  perform idle_expect_rejected('select set_idle_reminder_policy(true,300)','IDLE_REMINDER_POLICY_FORBIDDEN');
  reset role;
 end loop;
end $$;
rollback;
