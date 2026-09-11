do $$
declare org uuid:='00000000-0000-0000-0000-000000000002'; invite uuid; holder uuid:=gen_random_uuid();
  reserved jsonb; result jsonb; total integer; person uuid; invited_role text; kind text; project uuid;
begin
  insert into invitations(organization_id,email,role) values(org,'hr@example.test','hr') returning id into invite;
  reserved:=public.claim_invitation(invite,holder);
  perform expect_rejected(format('select public.claim_invitation(%L,%L)',invite,gen_random_uuid()),'INVITATION_BUSY');
  person:=(reserved->>'profile_id')::uuid;
  insert into auth.users values((reserved->>'auth_user_id')::uuid,'hr@example.test',jsonb_build_object('invitation_id',invite,'organization_id',org,'app_user_id',person,'user_type','developer','role','hr'));
  -- Any failure, including terms, rolls back the profile and seat together.
  perform expect_rejected(format('select public.finish_invitation(%L,%L,''HR'',null)',invite,holder),'Terms version is required');
  select count(*) into total from developers where id=person;
  if total<>0 then raise exception 'Failed invitation left a profile'; end if;
  result:=public.finish_invitation(invite,holder,'HR','2026-09-11','127.0.0.1');
  if result->>'userType'<>'developer' then raise exception 'HR identity mapping drift'; end if;
  if (select status from invitations where id=invite)<>'accepted' then raise exception 'Invitation not consumed'; end if;
  if not exists(select 1 from memberships where user_id=person and role='hr' and user_type='developer') then raise exception 'Membership missing'; end if;
  if not exists(select 1 from terms_acceptances where user_id=person and document_version='2026-09-11') then raise exception 'Terms missing'; end if;
  perform expect_rejected(format('select public.finish_invitation(%L,%L,''HR'',''version'')',invite,holder),'INVITATION_UNAVAILABLE');
  -- Releasing a completed claim must not make it reusable or cleanup eligible.
  perform public.release_invitation_claim(invite,holder);
  if jsonb_array_length(public.claim_invitation_cleanup())<>0 then raise exception 'Completed account offered for cleanup'; end if;

  insert into invitations(organization_id,email,role) values(org,'finance@example.test','finance') returning id into invite;
  reserved:=public.claim_invitation(invite,holder);
  person:=(reserved->>'profile_id')::uuid;
  insert into auth.users values((reserved->>'auth_user_id')::uuid,'finance@example.test',jsonb_build_object('invitation_id',invite,'organization_id',org,'app_user_id',person,'user_type','developer','role','finance'));
  -- An attempt that dies after Auth creation reuses exactly the reserved IDs.
  perform public.release_invitation_claim(invite,holder);
  holder:=gen_random_uuid();
  if public.claim_invitation(invite,holder)<>reserved then raise exception 'Retry lost reserved account identity'; end if;
  -- A seat failure occurs AFTER the profile insert but must roll it back too.
  update billing_plans set limits=jsonb_set(limits,'{employees}','1') where code='professional';
  perform expect_rejected(format('select public.finish_invitation(%L,%L,''Finance'',''version'')',invite,holder),'PLAN_LIMIT_REACHED');
  if exists(select 1 from developers where id=person) then raise exception 'Seat failure left a profile'; end if;
  if (select status from invitations where id=invite)<>'pending' then raise exception 'Failed invitation consumed'; end if;
  update billing_plans set limits=jsonb_set(limits,'{employees}','4') where code='professional';
  perform public.finish_invitation(invite,holder,'Finance','version');

  -- All supported invitation roles must agree with JWT and profile storage.
  update billing_plans set limits=limits||'{"employees":-1,"developers":-1,"projects":-1}'::jsonb where code='professional';
  insert into projects(organization_id,name) values(org,'Invitation client scope') returning id into project;
  foreach invited_role in array array['admin','manager','team_lead','developer','designer','devops','qa','employee','client'] loop
    kind:=case when invited_role='admin' then 'admin' when invited_role='client' then 'client' else 'developer' end;
    insert into invitations(organization_id,email,role,project_id) values(org,invited_role||'@example.test',invited_role,case when kind='client' then project end) returning id into invite;
    reserved:=public.claim_invitation(invite,holder);
    person:=(reserved->>'profile_id')::uuid;
    insert into auth.users values((reserved->>'auth_user_id')::uuid,invited_role||'@example.test',jsonb_build_object('invitation_id',invite,'organization_id',org,'app_user_id',person,'user_type',kind,'role',invited_role));
    result:=public.finish_invitation(invite,holder,invited_role,'role-regression');
    if result->>'userType'<>kind or not exists(select 1 from memberships where user_id=person and role=invited_role and user_type=kind) then raise exception 'Role mapping failed: %',invited_role; end if;
    if kind='admin' then
      if not exists(select 1 from admin_users a join organizations o on o.id=a.organization_id where a.id=person and a.company=o.name) then raise exception 'Admin company missing'; end if;
    elsif kind='client' then
      if not exists(select 1 from clients where id=person) or not exists(select 1 from project_clients where client_id=person and project_id=project) then raise exception 'Client profile or project link missing'; end if;
    elsif not exists(select 1 from developers where id=person) then raise exception 'Staff profile missing'; end if;
    if not exists(select 1 from terms_acceptances where user_id=person and user_type=kind and entry_point='invitation') then raise exception 'Terms identity mismatch'; end if;
  end loop;

  -- Abandoned Auth identities are claimed for cleanup only after expiry and
  -- with a fresh lease, so two cron workers cannot delete/reconcile together.
  insert into invitations(organization_id,email,role) values(org,'abandoned@example.test','developer') returning id into invite;
  reserved:=public.claim_invitation(invite,holder);
  update invitations set expires_at=now()-interval '1 second' where id=invite;
  perform public.release_invitation_claim(invite,holder);
  insert into developers(id,organization_id,auth_user_id) values((reserved->>'profile_id')::uuid,org,(reserved->>'auth_user_id')::uuid);
  if jsonb_array_length(public.claim_invitation_cleanup())<>0 then raise exception 'Manually recovered profile offered for Auth deletion'; end if;
  delete from developers where id=(reserved->>'profile_id')::uuid;
  result:=public.claim_invitation_cleanup();
  if jsonb_array_length(result)<>1 or result->0->>'auth_user_id'<>reserved->>'auth_user_id' then raise exception 'Recovery identity mismatch'; end if;
  if jsonb_array_length(public.claim_invitation_cleanup())<>0 then raise exception 'Recovery lease ignored'; end if;
  perform public.finish_invitation_cleanup(invite,(result->0->>'claim_id')::uuid);
  set local role authenticated;
  perform expect_rejected(format('select public.claim_invitation(%L,%L)',invite,holder),'permission denied');
  reset role;
end; $$;
