\set ON_ERROR_STOP on
\ir task_assignment_notifications.sql
alter table projects add column name text,add column assigned_developer_id uuid,add column assigned_to uuid,add column created_by_type text,add column added_by_type text,add column manager_id uuid,add column manager_type text;
alter table developer_tasks add column status text default 'pending';
create table milestones(id uuid primary key,organization_id uuid,project_id uuid,title text,status text);
-- Dependency contract doubles: the owner/manager helpers' legacy resolution is
-- covered by typed_project_ownership.sql; here exercise typed recipient use.
create function project_actor_is_owner(o uuid,p uuid,u uuid,t text,legacy boolean default false) returns boolean language sql as $$ select exists(select 1 from projects where organization_id=o and id=p and ((created_by=u and created_by_type=t) or (added_by=u and added_by_type=t))) $$;
create function project_actor_is_manager(o uuid,p uuid,u uuid,t text) returns boolean language sql as $$ select exists(select 1 from projects where organization_id=o and id=p and manager_id=u and manager_type=t) $$;
\ir ../../supabase/migrations/20260911170307_production_atomic_work_transition_notices.sql
do $$ declare org uuid:='00000000-0000-0000-0000-000000000001'; person uuid:='00000000-0000-0000-0000-000000000011'; project uuid:='83000000-0000-0000-0000-000000000001'; task uuid:='83000000-0000-0000-0000-000000000002'; milestone uuid:='83000000-0000-0000-0000-000000000003'; n bigint; kind text; begin
 perform set_config('test.assignment_fail','no',true);
 delete from user_permissions; delete from notification_preferences;
 update memberships set status='active',role='developer' where organization_id=org and user_id=person and user_type='developer';
 insert into projects(id,organization_id,name,assigned_developer_id,created_by,created_by_type) values(project,org,'Delivery',person,person,'admin');
 if (select count(*) from notifications where type='project_assigned' and project_id=project and developer_id=person)<>1 then raise exception 'Project assignment missing'; end if;
 update projects set assigned_developer_id=person where id=project;
 if (select count(*) from notifications where type='project_assigned' and project_id=project)<>1 then raise exception 'Project retry duplicated'; end if;
 insert into developer_tasks(id,organization_id,project_id,developer_id,task_title) values(task,org,project,person,'Work');
 update developer_tasks set status='in_progress' where id=task;
 update developer_tasks set status='in_progress' where id=task;
 if (select count(*) from notifications where type='task_status_changed' and task_id=task)<>1 then raise exception 'Task transition missing/duplicated'; end if;
 update developer_tasks set status='completed' where id=task;
 if (select count(*) from notifications where type='task_status_changed' and task_id=task)<>1 then raise exception 'Terminal review duplicated'; end if;
 insert into milestones values(milestone,org,project,'First delivery','completed');
 if (select count(*) from notifications where type='milestone_completed' and entity_id=milestone)<>2 then raise exception 'Typed colliding owner and developer not both notified'; end if;
 update milestones set status='completed' where id=milestone;
 update milestones set status='pending' where id=milestone;
 update milestones set status='completed' where id=milestone;
 if (select count(*) from notifications where type='milestone_completed' and entity_id=milestone)<>4 then raise exception 'Milestone retry/reopen incorrect'; end if;
 insert into user_permissions(membership_id,permission_key,allowed) select id,k,false from memberships cross join unnest(array['project.view_own','project.view_all']) k where organization_id=org and user_id=person and user_type='developer';
 update milestones set status='pending' where id=milestone;
 update milestones set status='completed' where id=milestone;
 if (select count(*) from notifications where type='milestone_completed' and entity_id=milestone and developer_id=person)<>2 then raise exception 'Explicit project read deny ignored'; end if;
 delete from user_permissions;
 perform set_config('test.assignment_fail','yes',true);
 begin update projects set assigned_developer_id=null where id=project; update projects set assigned_developer_id=person where id=project; raise exception 'Expected project delivery failure'; exception when others then if sqlerrm<>'INJECTED_NOTICE_FAILURE' then raise; end if; end;
 if (select assigned_developer_id from projects where id=project)<>person then raise exception 'Partial project assignment committed'; end if;
 begin update developer_tasks set status='in_progress' where id=task; raise exception 'Expected task delivery failure'; exception when others then if sqlerrm<>'INJECTED_NOTICE_FAILURE' then raise; end if; end;
 if (select status from developer_tasks where id=task)<>'completed' then raise exception 'Partial task status committed'; end if;

 begin update milestones set status='pending' where id=milestone; update milestones set status='completed' where id=milestone; raise exception 'Expected delivery failure'; exception when others then if sqlerrm<>'INJECTED_NOTICE_FAILURE' then raise; end if; end;
 if (select status from milestones where id=milestone)<>'completed' then raise exception 'Partial milestone committed'; end if;
 perform set_config('test.assignment_fail','no',true);
 perform set_config('request.jwt.claims',jsonb_build_object('app_metadata',jsonb_build_object('organization_id',org,'app_user_id',person,'user_type','developer'))::text,true);
 set local role authenticated;
 foreach kind in array array['project_assigned','task_status_changed','milestone_completed'] loop
  perform expect_notice_denied(jsonb_build_object('type',kind,'developer_id',person));
  begin
   update notifications set type=kind where id='10000000-0000-0000-0000-000000000003';
   raise exception 'Expected notification UPDATE forgery refusal';
  exception when insufficient_privilege then null; end;
 end loop;
 reset role;
end $$;
