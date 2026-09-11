do $$ declare org uuid:='00000000-0000-0000-0000-000000000002'; managed uuid:='20000000-0000-0000-0000-000000000001'; unassigned uuid:='20000000-0000-0000-0000-000000000002'; person uuid:='10000000-0000-0000-0000-000000000002'; total integer; begin
  perform set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","app_user_id":"10000000-0000-0000-0000-000000000001","user_type":"developer","role":"manager"},"test_overrides":{"capacity.allocate":false}}',true);
  set local role authenticated;
  perform expect_rejected(format('insert into project_members(organization_id,project_id,user_id,user_type,project_role) values(%L,%L,%L,''developer'',''manager'')',org,unassigned,public.auth_app_user_id()),'new row violates row-level security');
  insert into project_members(organization_id,project_id,user_id,user_type,project_role) values(org,managed,person,'developer','developer');
  perform expect_rejected(format('update project_members set allocation_pct=50 where user_id=%L',person),'permission denied: capacity.allocate');
  update project_members set project_role='qa' where user_id=person;
  perform expect_rejected(format('update project_members set project_id=%L where user_id=%L',unassigned,person),'permission denied: immutable project membership identity');
  perform expect_rejected('update project_members set project_role=''developer'' where project_role=''manager''','Assign a different manager');
  perform expect_rejected('delete from project_members where project_role=''manager''','Assign a different manager');
  perform expect_rejected(format('insert into project_members(organization_id,project_id,user_id,user_type,project_role) values(%L,%L,%L,''developer'',''developer'')',org,managed,gen_random_uuid()),'Project team requires an active staff membership');
  reset role;
  perform set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","app_user_id":"10000000-0000-0000-0000-000000000001","user_type":"developer","role":"manager"},"test_overrides":{"project.manage_members":false,"capacity.allocate":true}}',true);
  set local role authenticated;
  update project_members set allocation_pct=50 where user_id=person;
  get diagnostics total=row_count;
  if total<>1 then raise exception 'Allocation grant did not work independently'; end if;
  perform expect_rejected(format('update project_members set project_role=''developer'' where user_id=%L',person),'permission denied: project.manage_members');
  reset role;
  -- A project manager's scoped role works even without an org manager role.
  perform set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","app_user_id":"10000000-0000-0000-0000-000000000001","user_type":"developer","role":"developer"}}',true);
  set local role authenticated;
  update project_members set project_role='developer' where user_id=person;
  get diagnostics total=row_count;
  if total<>1 then raise exception 'Scoped manager grant ignored'; end if;
  reset role;
end; $$;
