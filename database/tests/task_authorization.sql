-- Run with -f in a fresh database; fixture and production policies included.
\ir task_authorization_fixture.sql
\ir ../../supabase/migrations/20260911100211_production_task_authorization.sql
\ir ../../supabase/migrations/20260911083449_production_task_review_integrity.sql
create function test_login(p_org uuid,p_user uuid,p_type text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claims',jsonb_build_object('org',p_org,'user',p_user,'type',p_type,
   'app_metadata',jsonb_build_object('organization_id',p_org,'app_user_id',p_user,'user_type',p_type))::text,true);
end $$;
create function test_denied(command text) returns void language plpgsql as $$ begin
 begin execute command; exception when insufficient_privilege then return; end;
 raise exception 'Expected denial: %',command;
end $$;
begin;
do $$ declare org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); developer uuid:=gen_random_uuid(); colleague uuid:=gen_random_uuid();
 actor uuid:=gen_random_uuid(); client uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); other_project uuid:=gen_random_uuid();
 task uuid:=gen_random_uuid(); other_task uuid:=gen_random_uuid(); bug uuid:=gen_random_uuid(); actor_role text; changed int; removable uuid:=gen_random_uuid();
begin
 insert into memberships values(org,developer,'developer','developer','active'),(org,colleague,'developer','developer','active'),
  (org,actor,'admin','owner','active'),(org,client,'client','client','active');
 insert into projects values(project,org,developer,false,'draft'),(other_project,other_org,colleague,false,'draft');
 insert into project_clients values(project,client);
 insert into developer_tasks(id,organization_id,project_id,developer_id,task_title) values(task,org,project,developer,'Mine'),(other_task,org,project,colleague,'Theirs');
 insert into developer_tasks(id,organization_id,project_id,task_type,task_title) values(bug,org,project,'bug','Bug');
 perform test_login(org,developer,'developer');
 set local role authenticated;
 if (select count(*) from developer_tasks)<>1 then raise exception 'Contributor can see unrelated work'; end if;
 update developer_tasks set task_title='Draft edit' where id=task;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Own draft edit blocked'; end if;
 perform test_denied(format('update developer_tasks set status=''reviewed'' where id=%L',task));
 update developer_tasks set status='in_progress' where id=task;
 update developer_tasks set task_description='Started plan editable' where id=task;
 perform test_denied(format('update developer_tasks set developer_id=%L where id=%L',colleague,task));
 perform test_denied(format('update developer_tasks set project_id=%L where id=%L',other_project,task));
 perform test_denied(format('update developer_tasks set client_visible=true where id=%L',task));
 perform test_denied(format('update developer_tasks set status=''completed'' where id=%L',task));
 update developer_tasks set task_title='Forged' where id=other_task;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Other task edited'; end if;
 delete from developer_tasks where id=other_task;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Other task deleted'; end if;
 perform test_denied(format('insert into developer_tasks(organization_id,project_id,developer_id) values(%L,%L,%L)',org,project,developer));
 reset role;
 update projects set task_plan_submitted=false,task_plan_status='approved' where id=project;
 set local role authenticated;
 perform test_denied(format('update developer_tasks set task_title=''Approved plan edit'' where id=%L',task));
 delete from developer_tasks where id=task;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Approved plan deleted'; end if;
 reset role;
 update projects set task_plan_status='rejected' where id=project;
 set local role authenticated;
 update developer_tasks set end_date=current_date+1 where id=task;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Rejected plan edit blocked'; end if;
 reset role;
 insert into user_permissions values(developer,'developer','task.update_own',false);
 set local role authenticated;
 update developer_tasks set task_title='Denied' where id=task;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Own update deny bypassed'; end if;
 reset role;
 delete from user_permissions;
 insert into developer_tasks(id,organization_id,project_id,developer_id) values(removable,org,project,developer);
 set local role authenticated;
 delete from developer_tasks where id=removable;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Own rejected-plan delete blocked'; end if;
 reset role;
 insert into user_permissions values(developer,'developer','task.view_own',false);
 set local role authenticated;
 if exists(select 1 from developer_tasks where id=task) then raise exception 'Own read deny bypassed'; end if;
 reset role;
 delete from user_permissions;
 update memberships set status='suspended' where user_id=developer;
 set local role authenticated;
 if exists(select 1 from developer_tasks) then raise exception 'Suspended reader accepted'; end if;
 reset role;
 update memberships set status='active' where user_id=developer;
 -- A colliding admin profile is not the developer assignment.
 insert into memberships values(org,developer,'admin','hr','active');
 perform test_login(org,developer,'admin');
 set local role authenticated;
 if exists(select 1 from developer_tasks where id=task) then raise exception 'Profile collision read'; end if;
 reset role;
 -- All supervisor defaults, and explicit deny even for owner.
 foreach actor_role in array array['owner','admin','manager','team_lead'] loop
   update memberships set role=actor_role where user_id=actor;
   perform test_login(org,actor,'admin');
   set local role authenticated;
   update developer_tasks set task_title=actor_role,developer_id=colleague where id=task;
   get diagnostics changed=row_count;
   if changed<>1 then raise exception 'Supervisor management blocked'; end if;
   perform test_denied(format('update developer_tasks set project_id=%L where id=%L',other_project,task));
   reset role;
 end loop;
 update memberships set role='owner' where user_id=actor;
 insert into user_permissions values(actor,'admin','task.manage',false);
 set local role authenticated;
 update developer_tasks set task_title='Denied owner' where id=task;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Owner deny bypassed'; end if;
 reset role;
 delete from user_permissions;
 update developer_tasks set developer_id=developer where id=other_task;
 update memberships set status='suspended' where user_id=colleague;
 set local role authenticated;
 perform test_denied(format('update developer_tasks set developer_id=%L where id=%L',colleague,other_task));
 reset role;
 -- QA sees review work and creates/tracks defects, without general assignment.
 update memberships set role='qa' where user_id=actor;
 set local role authenticated;
 insert into developer_tasks(organization_id,project_id,task_type,reported_by,task_title) values(org,project,'bug',actor,'Reported');
 update developer_tasks set status='in_progress' where id=bug;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'QA triage blocked'; end if;
 update developer_tasks set status='awaiting_approval' where id=bug;
 update developer_tasks set status='reviewed' where id=bug;
 perform test_denied(format('update developer_tasks set developer_id=%L where id=%L',developer,bug));
 perform test_denied(format('insert into developer_tasks(organization_id,project_id,task_type) values(%L,%L,''feature'')',org,project));
 reset role;
 -- An explicit capability grant works independently of the default role.
 update memberships set role='hr' where user_id=actor;
 insert into user_permissions values(actor,'admin','task.manage',true),(actor,'admin','task.view_all',true);
 set local role authenticated;
 update developer_tasks set task_title='Granted manager' where id=task;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Explicit management grant blocked'; end if;
 reset role;
 delete from user_permissions;
 -- Published client access requires both project linkage and plan feature.
 update developer_tasks set client_visible=true where id=task;
 perform test_login(org,client,'client');
 set local role authenticated;
 if (select count(*) from developer_tasks)<>1 then raise exception 'Client visibility wrong'; end if;
 perform set_config('test.client_feature','no',true);
 if exists(select 1 from developer_tasks) then raise exception 'Client plan bypass'; end if;
 reset role;
 perform set_config('test.client_feature','yes',true);
 delete from project_clients;
 set local role authenticated;
 if exists(select 1 from developer_tasks) then raise exception 'Unlinked client access'; end if;
 reset role;
 -- Service transactions and authorized parent cascade retain their behavior.
 alter role service_role bypassrls;
 set local role service_role;
 update developer_tasks set status='completed',productivity_points=1 where id=task;
 reset role;
 perform test_login(org,actor,'admin');
 set local role authenticated;
 delete from projects where id=project;
 reset role;
 if exists(select 1 from developer_tasks where project_id=project) then raise exception 'Parent cascade blocked'; end if;
end $$;
rollback;
