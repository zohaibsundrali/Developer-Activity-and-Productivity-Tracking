-- Fresh database; reuse identity/table scaffold only (no task policies needed).
\ir task_authorization_fixture.sql
alter table projects add column status text default 'pending',add column progress numeric default 0,
 add column total_tasks_count int default 0,add column completed_tasks_count int default 0,add column total_productivity_score numeric default 0,
 add column is_template boolean default false,add column name text,add column created_by uuid,
 add column added_by uuid,add column manager_id uuid,add column assigned_to uuid,
 add column task_plan_submitted_at timestamptz,add column task_plan_reviewed_at timestamptz,
 add column task_plan_reviewed_by uuid,add column task_plan_rejection_reason text,
 add column completed_at timestamptz,add column completed_by uuid,add column closed_at timestamptz,add column closed_by uuid,
 add column client_signed_off_at timestamptz,add column client_rating int,add column client_feedback text,add column closure_note text;
alter table projects enable row level security;
create policy legacy_projects_all on projects for all to authenticated using(true) with check(true);
\ir ../../supabase/migrations/20260911101008_production_project_mutation_authority.sql
create function project_test_login(p_org uuid,p_actor uuid,p_type text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claims',jsonb_build_object('org',p_org,'user',p_actor,'type',p_type,
  'app_metadata',jsonb_build_object('user_type',p_type))::text,true);
end $$;
create function project_test_denied(command text) returns void language plpgsql as $$ begin
 begin execute command; exception when insufficient_privilege then return; end;
 raise exception 'Expected project refusal: %',command;
end $$;
begin;
do $$ declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); developer uuid:=gen_random_uuid();
 project uuid:=gen_random_uuid(); fresh uuid; role_name text; changed int; field text;
begin
 insert into memberships values(org,actor,'admin','owner','active'),(org,developer,'developer','developer','active');
 insert into projects(id,organization_id,assigned_developer_id,assigned_to,task_plan_submitted,task_plan_status)
  values(project,org,developer,developer,true,'approved');
 perform project_test_login(org,developer,'developer');
 set local role authenticated;
 if not exists(select 1 from projects where id=project) then raise exception 'Read lost'; end if;
 update projects set task_plan_status='rejected',task_plan_submitted=false where id=project;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Contributor reopened own plan'; end if;
 update projects set assigned_developer_id=developer where id=project;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Contributor mutated assignment'; end if;
 delete from projects where id=project;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Contributor deleted parent project'; end if;
 perform project_test_denied(format('insert into projects(id,organization_id) values(%L,%L)',gen_random_uuid(),org));
 reset role;
 foreach role_name in array array['owner','admin','manager','team_lead'] loop
  update memberships set role=role_name where user_id=actor;
  perform project_test_login(org,actor,'admin');
  set local role authenticated;
  update projects set is_template=true where id=project;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Template update blocked for %',role_name; end if;
  perform project_test_denied(format('update projects set task_plan_status=''rejected'' where id=%L',project));
  perform project_test_denied(format('update projects set assigned_developer_id=%L where id=%L',actor,project));
  perform project_test_denied(format('update projects set manager_id=%L where id=%L',actor,project));
  perform project_test_denied(format('update projects set closed_at=now() where id=%L',project));
  perform project_test_denied(format('update projects set status=''completed'' where id=%L',project));
  foreach field in array array['progress','total_tasks_count','completed_tasks_count','total_productivity_score'] loop
    perform project_test_denied(format('update projects set %I=99 where id=%L',field,project));
    perform project_test_denied(format('insert into projects(id,organization_id,%I) values(%L,%L,99)',field,gen_random_uuid(),org));
  end loop;
  perform project_test_denied(format('insert into projects(id,organization_id,status) values(%L,%L,''completed'')',gen_random_uuid(),org));
  perform project_test_denied(format('insert into projects(id,organization_id,status) values(%L,%L,''closed'')',gen_random_uuid(),org));
  fresh:=gen_random_uuid();
  insert into projects(id,organization_id,assigned_developer_id,assigned_to,task_plan_status)
   values(fresh,org,developer,developer,'draft');
  perform project_test_denied(format('insert into projects(id,organization_id,task_plan_status) values(%L,%L,''approved'')',gen_random_uuid(),org));
  perform project_test_denied(format('insert into projects(id,organization_id,closed_at) values(%L,%L,now())',gen_random_uuid(),org));
  delete from projects where id=fresh;
  get diagnostics changed=row_count;
  if changed<>(case when role_name in ('owner','admin') then 1 else 0 end) then raise exception 'Delete authority wrong for %',role_name; end if;
  reset role;
 end loop;
 update memberships set role='owner' where user_id=actor;
 insert into user_permissions values(actor,'admin','project.hub',false),(actor,'admin','project.delete',false),(actor,'admin','project.create',false);
 set local role authenticated;
 update projects set is_template=false where id=project;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Template explicit deny ignored'; end if;
 delete from projects where id=project;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Delete explicit deny ignored'; end if;
 perform project_test_denied(format('insert into projects(id,organization_id) values(%L,%L)',gen_random_uuid(),org));
 reset role;
 -- Service workflows retain assignment, submission, verdict and closure access.
 alter role service_role bypassrls;
 set local role service_role;
 update projects set task_plan_status='pending',task_plan_submitted=true,task_plan_submitted_at=now() where id=project;
 update projects set task_plan_status='approved',task_plan_reviewed_by=actor,task_plan_reviewed_at=now() where id=project;
 update projects set manager_id=actor,completed_at=now(),closed_at=now(),status='closed',progress=100,total_tasks_count=5,completed_tasks_count=5,total_productivity_score=5 where id=project;
 reset role;
 if (select task_plan_reviewed_by from projects where id=project)<>actor then raise exception 'Service review blocked'; end if;
end $$;
rollback;
