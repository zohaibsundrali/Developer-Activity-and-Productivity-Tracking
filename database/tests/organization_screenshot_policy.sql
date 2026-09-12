\ir idempotent_screenshot_capture.sql
create or replace function app_private.storage_org(p_bucket text,p_name text) returns uuid
language plpgsql stable security definer set search_path = pg_catalog,public
as $$
declare segment text; org uuid;
begin
  segment := split_part(p_name,'/',1);
  if p_bucket='task-submissions' then
    if segment='pm' then segment:=split_part(p_name,'/',2);
    elsif segment='submissions' then
      select d.organization_id into org from public.developers d where d.id::text=split_part(p_name,'/',2);
      return org;
    end if;
  end if;
  select id into org from public.organizations where id::text=segment;
  if org is not null then return org; end if;
  -- Legacy screenshot paths are attributed by the existing database record,
  -- never by guessing from an email local-part or trusting upload metadata.
  if p_bucket in ('screenshots','documents','monitoring') then
    select min(s.organization_id::text)::uuid into org from public.screenshots s
      where s.storage_path=p_name having count(distinct s.organization_id)=1;
  end if;
  return org;
end; $$;
\ir ../../supabase/migrations/20260912074017_production_organization_screenshot_policy.sql
-- Existing fixture has finalized captures and an enrolled but revoked device.
create or replace function public.auth_override(key text) returns boolean language sql stable as $$
 select (auth.jwt()->'app_metadata'->'permission_overrides'->>key)::boolean $$;
do $$
declare policy jsonb; cap uuid:='10000000-0000-0000-0000-000000000001';
 dev_claims jsonb:=jsonb_set(auth.jwt(),'{session_id}','"00000000-0000-0000-0000-000000000022"'); admin_claims jsonb;
begin
 if has_table_privilege('authenticated','organization_screenshot_policies','INSERT')
 or has_function_privilege('anon','public.set_screenshot_policy(boolean,integer)','EXECUTE') then raise exception 'Unsafe grant'; end if;
 set local role authenticated;
 policy:=get_screenshot_policy();
 if policy->>'enabled'<>'true' or policy->>'interval_seconds'<>'60' or policy->>'can_manage'<>'false' then raise exception 'Wrong defaults'; end if;
 perform expect_rejected('select set_screenshot_policy(false,120)','SCREENSHOT_POLICY_FORBIDDEN');
 admin_claims:=jsonb_set(dev_claims,'{app_metadata,user_type}','"admin"');
 admin_claims:=jsonb_set(admin_claims,'{app_metadata,role}','"admin"');
 perform set_config('request.jwt.claims',admin_claims::text,true);
 if get_screenshot_policy()->>'can_manage'<>'true' then raise exception 'Admin policy missing'; end if;
 perform expect_rejected('select set_screenshot_policy(null,120)','SCREENSHOT_POLICY_INVALID');
 perform expect_rejected('select set_screenshot_policy(true,59)','SCREENSHOT_POLICY_INVALID');
 perform expect_rejected('select set_screenshot_policy(true,3601)','SCREENSHOT_POLICY_INVALID');
 policy:=set_screenshot_policy(false,300);
 if policy->>'enabled'<>'false' or policy->>'interval_seconds'<>'300' then raise exception 'Save failed'; end if;
 perform expect_rejected('update organization_screenshot_policies set enabled=true','permission denied');
 perform set_config('request.jwt.claims',jsonb_set(admin_claims,'{app_metadata,permission_overrides}','{"organization.settings":false}')::text,true);
 perform expect_rejected('select set_screenshot_policy(true,120)','SCREENSHOT_POLICY_FORBIDDEN');
 perform set_config('request.jwt.claims',dev_claims::text,true);
 perform enroll_tracker_device('policy-device','test');
 -- Existing exact ACK is safe while policy disabled; no new image mutation.
 if finalize_screenshot_capture(cap,screenshot_test_payload(cap))->>'success'<>'true' then raise exception 'Disabled broke receipt'; end if;
 perform expect_rejected('insert into storage.objects(bucket_id,name,metadata) values(''monitoring'',''00000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000012/new.png'',''{"size":1024}'')','SCREENSHOTS_DISABLED');
 perform expect_rejected('update storage.objects set metadata=''{}'' where bucket_id=''monitoring''','SCREENSHOTS_DISABLED');
 perform expect_rejected('insert into screenshots(organization_id,developer_id,developer_email,filename,storage_path,width,height,size_kb,mime_type) values(''00000000-0000-0000-0000-000000000002'',''00000000-0000-0000-0000-000000000012'',''dev@example.test'',''x'',''x'',1,1,1,''image/png'')','SCREENSHOTS_DISABLED');
 perform set_config('request.jwt.claims',jsonb_set(admin_claims,'{app_metadata,organization_id}','"00000000-0000-0000-0000-000000000001"')::text,true);
 if exists(select 1 from organization_screenshot_policies) then raise exception 'Cross-tenant read'; end if;
 if get_screenshot_policy()->>'enabled'<>'true' then raise exception 'Cross-tenant default'; end if;
 perform set_config('request.jwt.claims',admin_claims::text,true);
 reset role;
 insert into organization_subscriptions(organization_id,plan_code,status) values('00000000-0000-0000-0000-000000000002','professional','unpaid');
 set local role authenticated;
 perform set_screenshot_policy(false,600);
 perform expect_rejected('select set_screenshot_policy(true,120)','BILLING_LOCKED');
 reset role;
 delete from organization_subscriptions;
 set local role authenticated;
 perform set_screenshot_policy(true,120);
 perform set_config('request.jwt.claims',dev_claims::text,true);
 insert into storage.objects(bucket_id,name,metadata) values('monitoring','00000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000012/new.png','{"size":1024}');
 reset role;
end; $$;
