\set ON_ERROR_STOP on
\ir task_notification_privacy.sql
alter table memberships add column team_id uuid;
alter table projects add column assigned_to uuid,add column created_by_type text,add column added_by_type text,add column manager_id uuid,add column manager_type text;
create table project_members(organization_id uuid,project_id uuid,user_id uuid,user_type text,project_role text);
create table teams(id uuid primary key,organization_id uuid);
grant select on project_members,teams to authenticated;
\ir ../../supabase/migrations/20260911163106_production_notification_entity_privacy.sql
insert into projects(id,organization_id) values('81000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
insert into teams values('81000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
-- Trusted inserts cannot make unassigned project/team/employee content readable.
insert into notifications(organization_id,developer_id,type,title,project_id,entity_type,entity_id) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','entity_test_project','Private project','81000000-0000-0000-0000-000000000001','project','81000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','entity_test_team','Private team',null,'team','81000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','entity_test_employee','Private employee',null,'employee','00000000-0000-0000-0000-000000000011');
select privacy_actor('developer','00000000-0000-0000-0000-000000000012');
set role authenticated;
do $$begin if exists(select 1 from notification_inbox where type like 'entity_test_%') then raise exception 'Unassigned entity leaked'; end if; end$$;
reset role;
insert into project_members values('00000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','developer','developer');
update memberships set team_id='81000000-0000-0000-0000-000000000002' where user_id='00000000-0000-0000-0000-000000000012' and user_type='developer';
set role authenticated;
do $$begin if (select count(*) from notification_inbox where type like 'entity_test_%')<>2 then raise exception 'Assigned project/team notices missing'; end if; end$$;
reset role;
insert into user_permissions select id,'team.view_own',false from memberships where user_id='00000000-0000-0000-0000-000000000012' and user_type='developer';
set role authenticated;
do $$begin if exists(select 1 from notification_inbox where type='entity_test_team') then raise exception 'Denied own team notice leaked'; end if; end$$;
reset role;
insert into user_permissions select id,'project.view_own',false from memberships where user_id='00000000-0000-0000-0000-000000000012' and user_type='developer';
update memberships set team_id=null where user_id='00000000-0000-0000-0000-000000000012' and user_type='developer';
set role authenticated;
do $$begin if exists(select 1 from notifications where type like 'entity_test_%') then raise exception 'Revoked project or removed team leaked'; end if; end$$;
reset role;
-- Explicit people-directory grant permits the employee notice and revocation hides it.
insert into user_permissions select id,'member.view',true from memberships where user_id='00000000-0000-0000-0000-000000000012' and user_type='developer';
set role authenticated;
do $$begin if (select count(*) from notification_inbox where type='entity_test_employee')<>1 then raise exception 'Explicit directory grant ignored'; end if; end$$;
reset role;
update user_permissions set allowed=false where permission_key='member.view';
-- A colliding Admin profile roster row must not restore Developer project access.
update user_permissions set allowed=true where permission_key='project.view_own';
update project_members set user_type='admin';
set role authenticated;
do $$begin if exists(select 1 from notification_inbox where type like 'entity_test_%') then raise exception 'Collision or directory revocation leaked'; end if; end$$;
reset role;
-- Role defaults do not override a denied explicit project grant.
update memberships set role='manager' where user_id='00000000-0000-0000-0000-000000000012' and user_type='developer';
set role authenticated;
do $$begin if (select count(*) from notification_inbox where type='entity_test_project')<>1 then raise exception 'Supervisor project notice missing'; end if; end$$;
reset role;
insert into user_permissions select id,'project.view_all',false from memberships where user_id='00000000-0000-0000-0000-000000000012' and user_type='developer';
set role authenticated;
do $$begin if exists(select 1 from notification_inbox where type='entity_test_project') then raise exception 'Denied supervisor project leaked'; end if; end$$;
reset role;

-- Canonical assignment wins over a legacy assigned_to value. Typed Developer
-- legacy ownership remains readable when the canonical field is absent.
update memberships set role='developer' where user_id='00000000-0000-0000-0000-000000000012' and user_type='developer';
update projects set assigned_to='00000000-0000-0000-0000-000000000012' where id='81000000-0000-0000-0000-000000000001';
set role authenticated;
do $$begin if (select count(*) from notification_inbox where type='entity_test_project')<>1 then raise exception 'Legacy own assignment hidden'; end if; end$$;
reset role;
update projects set assigned_developer_id='00000000-0000-0000-0000-000000000011' where id='81000000-0000-0000-0000-000000000001';
set role authenticated;
do $$begin if exists(select 1 from notification_inbox where type='entity_test_project') then raise exception 'Stale legacy assignment leaked'; end if; end$$;
reset role;
