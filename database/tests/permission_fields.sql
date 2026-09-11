do $$ declare changed integer; begin
  perform set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","role":"admin"}}',true);
  set local role authenticated;
  update organizations set name='Unauthorized' where id=public.auth_org();
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Admin changed owner-only settings'; end if;
  reset role;
  perform set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","role":"hr"},"test_overrides":{"employee.activate":true,"employee.transfer":false,"employment.set_hours":false}}',true);
  set local role authenticated;
  update employee_profiles set employment_status='suspended';
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Transfer deny blocked permitted activation'; end if;
  perform expect_rejected('update employee_profiles set team_id=gen_random_uuid()','permission denied: employee.transfer');
  perform expect_rejected('update employee_profiles set weekly_hours=60','permission denied: employment.set_hours');
  perform expect_rejected('update employee_profiles set user_id=gen_random_uuid()','permission denied: immutable employee identity');
  reset role;
  perform set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","role":"hr"},"test_overrides":{"hierarchy.manage":false,"employee.activate":false}}',true);
  set local role authenticated;
  perform expect_rejected('update memberships set reports_to=gen_random_uuid()','permission denied: hierarchy.manage');
  perform expect_rejected('update memberships set status=''suspended''','permission denied: employee.activate');
  reset role;
  perform set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","role":"developer"},"test_overrides":{"employee.activate":true}}',true);
  set local role authenticated;
  update employee_profiles set employment_status='active';
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Explicit activation grant ignored'; end if;
  perform expect_rejected('update employee_profiles set designation=''CEO''','permission denied: employee.manage');
  reset role;
end; $$;

do $$ declare total integer; begin
  perform set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","role":"client","user_type":"client"}}',true);
  set local role authenticated;
  select count(*) into total from change_requests;
  if total<>0 then raise exception 'Internal PM notes exposed through direct client query'; end if;
  reset role;
end; $$;
