do $$ declare claims jsonb:='{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","app_user_id":"10000000-0000-0000-0000-000000000001","user_type":"admin","role":"employee"}}'; begin
  perform set_config('request.jwt.claims',claims::text,true);
  set local role authenticated;
  if public.auth_override('organization.manage') is not null then raise exception 'Override leaked across profile types sharing a UUID'; end if;
  if public.auth_project_staffing('20000000-0000-0000-0000-000000000001','project.manage_members') then raise exception 'Project role leaked across profile types'; end if;
  reset role;
  claims:=jsonb_set(claims,'{app_metadata,user_type}','"developer"');
  perform set_config('request.jwt.claims',claims::text,true);
  set local role authenticated;
  if public.auth_project_staffing('20000000-0000-0000-0000-000000000001',null) then raise exception 'Missing permission key accepted'; end if;
  if public.auth_override('organization.manage') is distinct from true then raise exception 'Matching override lost'; end if;
  if not public.auth_project_staffing('20000000-0000-0000-0000-000000000001','project.manage_members') then raise exception 'Matching scoped manager lost'; end if;
  reset role;
  update memberships set status='suspended' where user_id='10000000-0000-0000-0000-000000000001' and user_type='developer';
  set local role authenticated;
  if public.auth_override('organization.manage') is not null then raise exception 'Suspended membership retained override'; end if;
  reset role;
end; $$;
