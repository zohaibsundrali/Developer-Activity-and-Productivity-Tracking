-- Isolated transaction fixture. Real proposal schema/guard and new RPC; quota
-- lock and project quota failure are injected (full quota suite runs separately).
do $$ begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create table organizations(id uuid primary key);
create table clients(id uuid primary key,organization_id uuid references organizations,status text,email text);
create table memberships(id uuid primary key default gen_random_uuid(),organization_id uuid,user_id uuid,user_type text,role text,status text,email text,unique(organization_id,user_id,user_type));
create table user_permissions(membership_id uuid,permission_key text,allowed boolean,unique(membership_id,permission_key));
create table projects(id uuid primary key default gen_random_uuid(),organization_id uuid,name text,description text,status text,budget numeric,deadline date,created_by uuid,created_by_type text,manager_id uuid,manager_type text);
create table project_clients(organization_id uuid,project_id uuid references projects on delete cascade,client_id uuid references clients,unique(project_id,client_id));
create table notifications(id uuid primary key default gen_random_uuid(),organization_id uuid,admin_id uuid,admin_recipient_type text,developer_id uuid,admin_email text,type text,category text,title text,message text,entity_type text,entity_id uuid,project_id uuid,read boolean);
create function auth_org() returns uuid language sql stable as $$ select nullif(current_setting('test.org',true),'')::uuid $$;
create function auth_is_client() returns boolean language sql stable as $$ select coalesce(current_setting('test.client',true),'no')='yes' $$;
create function auth_app_user_id() returns uuid language sql stable as $$ select nullif(current_setting('test.user',true),'')::uuid $$;
create function auth_role() returns text language sql stable as $$ select 'owner'::text $$;
create schema app_private;
create table app_private.quota_locks(organization_id uuid primary key,revision bigint not null);
create function app_private.lock_quota(p_org uuid) returns void language sql as $$ insert into app_private.quota_locks values(p_org,1) on conflict(organization_id) do update set revision=quota_locks.revision+1 $$;
create function app_private.org_unlocked(p_org uuid) returns boolean language sql as $$ select coalesce(current_setting('test.locked',true),'no')<>'yes' $$;
\ir ../059_project_proposals.sql
\ir ../062_proposal_estimates.sql
\ir ../../supabase/migrations/20260911163440_production_atomic_proposal_decisions.sql
-- Real roster and project-notice triggers; unrelated event tables are schema-only.
alter table projects add column assigned_developer_id uuid,add column assigned_to uuid;
alter table notifications add column task_id uuid,add column metadata jsonb;
create schema private;
create table developer_tasks(id uuid primary key,organization_id uuid,project_id uuid,developer_id uuid,task_type text,task_title text,status text);
create table milestones(id uuid primary key,organization_id uuid,project_id uuid,title text,status text);
create table project_members(organization_id uuid,project_id uuid references projects on delete cascade,user_id uuid,user_type text,project_role text,updated_at timestamptz,
 constraint project_members_unique unique(project_id,user_id));
create function project_unique_identity_type(p_org uuid,p_identifier text) returns text language sql stable as $$
 select case when count(distinct user_type)=1 then min(user_type) end from memberships where organization_id=p_org and user_id::text=p_identifier;
$$;
\ir ../../supabase/migrations/20260911123702_production_typed_project_manager_roster.sql
\ir ../../supabase/migrations/20260911170307_production_atomic_work_transition_notices.sql

grant usage on schema public to authenticated,service_role;
grant all on all tables in schema public to service_role;
create function proposal_failure() returns trigger language plpgsql as $$ begin
 if current_setting('test.failure',true)=tg_table_name then raise exception 'INJECTED_FAILURE'; end if; return new;
end $$;
create trigger fail_projects before insert on projects for each row execute function proposal_failure();
create trigger fail_links before insert on project_clients for each row execute function proposal_failure();
create trigger fail_decision before update on project_proposals for each row execute function proposal_failure();
create trigger fail_email before insert on proposal_decision_emails for each row execute function proposal_failure();
create trigger fail_notice before insert on notifications for each row execute function proposal_failure();
create function proposal_denied(command text,expected text) returns void language plpgsql as $$ begin
 begin execute command; exception when others then if position(expected in sqlerrm)>0 then return; else raise; end if; end;
 raise exception 'Expected refusal: %',command;
end $$;
begin;
do $$ declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); client uuid:=gen_random_uuid(); manager uuid:=gen_random_uuid(); proposal uuid:=gen_random_uuid(); member uuid; result jsonb; target text; mail public.proposal_decision_emails%rowtype; n int;
begin
 insert into organizations values(org);
 insert into clients values(client,org,'active','client@example.test');
 insert into memberships(organization_id,user_id,user_type,role,status,email) values(org,actor,'admin','owner','active','owner@example.test'),(org,client,'client','client','active','client@example.test'),(org,manager,'developer','manager','active','manager@example.test'),(org,manager,'admin','manager','inactive','old@example.test');
 select id into member from memberships where user_id=actor;
 insert into project_proposals(id,organization_id,client_id,title,description,budget,estimated_cost,estimated_timeline_days,internal_notes) values(proposal,org,client,'Scope','Description',900,0,12,'PRIVATE STAFF NOTE');
 perform set_config('test.org',org::text,true);
 set local role authenticated;
 perform proposal_denied(format('select decide_project_proposal(%L,%L,%L,''admin'',''accepted'')',org,proposal,actor),'permission denied');
 perform proposal_denied('select internal_notes from project_proposals','permission denied');
 perform id,title,status,created_at,client_id,desired_deadline,budget,currency from project_proposals;
 update project_proposals set status='in_review' where id=proposal;
 get diagnostics n=row_count; if n<>0 then raise exception 'Browser bypassed decision transaction'; end if;
 reset role;
 perform set_config('test.client','yes',true);perform set_config('test.user',client::text,true);
 set local role authenticated;
 perform proposal_denied('select internal_notes from project_proposals','permission denied');
 perform proposal_denied(format('insert into project_proposals(organization_id,client_id,title,description,estimated_cost) values(%L,%L,''Spoof estimate'',''Body'',0)',org,client),'permission denied');
 insert into project_proposals(organization_id,client_id,title,description,budget) values(org,client,'Client submitted','Public scope',50);
 reset role; perform set_config('test.client','no',true);
 foreach target in array array['projects','project_clients','project_proposals','proposal_decision_emails','notifications'] loop
  perform set_config('test.failure',target,true);
  set local role service_role;
  perform proposal_denied(format('select decide_project_proposal(%L,%L,%L,''admin'',''accepted'',null,%L,''developer'')',org,proposal,actor,manager),'INJECTED_FAILURE');
  reset role;
  if exists(select 1 from projects) or exists(select 1 from project_clients) or exists(select 1 from proposal_decision_emails) or exists(select 1 from notifications) or (select status from project_proposals where id=proposal)<>'submitted' then raise exception 'Partial acceptance leaked after %',target; end if;
 end loop;
 perform set_config('test.failure','',true);
 insert into user_permissions values(member,'proposal.decide',false);
 set local role service_role;
 perform proposal_denied(format('select decide_project_proposal(%L,%L,%L,''admin'',''accepted'')',org,proposal,actor),'PROPOSAL_FORBIDDEN');
 reset role; delete from user_permissions;
 foreach target in array array['project.create','project.assign_manager'] loop
  insert into user_permissions values(member,target,false);
  set local role service_role;
  perform proposal_denied(format('select decide_project_proposal(%L,%L,%L,''admin'',''accepted'',null,%L,''developer'')',org,proposal,actor,manager),'PROPOSAL_FORBIDDEN');
  reset role;delete from user_permissions;
 end loop;
 set local role service_role;
 perform proposal_denied(format('select decide_project_proposal(%L,%L,%L,''developer'',''accepted'')',org,proposal,actor),'PROPOSAL_FORBIDDEN');
 perform proposal_denied(format('select decide_project_proposal(%L,%L,%L,''admin'',''accepted'')',gen_random_uuid(),proposal,actor),'PROPOSAL_FORBIDDEN');
 reset role;
 update clients set status='inactive' where id=client;
 set local role service_role;
 perform proposal_denied(format('select decide_project_proposal(%L,%L,%L,''admin'',''accepted'')',org,proposal,actor),'inactive client');
 reset role;update clients set status='active' where id=client;
 perform set_config('test.locked','yes',true);
 set local role service_role;
 perform proposal_denied(format('select decide_project_proposal(%L,%L,%L,''admin'',''accepted'')',org,proposal,actor),'BILLING_LOCKED');
 reset role;perform set_config('test.locked','no',true);
 set local role service_role;
 perform proposal_denied(format('select decide_project_proposal(%L,%L,%L,''admin'',''accepted'',null,%L)',org,proposal,actor,manager),'ambiguous manager');
 result:=decide_project_proposal(org,proposal,actor,'admin','accepted','public reason',manager,'developer');
 if (result->'project'->>'budget')::numeric<>0 or (result->'project'->>'deadline')::date<>(now() at time zone 'UTC')::date+12 then raise exception 'Estimate precedence lost'; end if;
 if result->'project'->>'manager_type'<>'developer' then raise exception 'Typed manager lost'; end if;
 result:=decide_project_proposal(org,proposal,actor,'admin','accepted');
 if result->>'replayed'<>'true' then raise exception 'Accepted replay not recovered'; end if;
 perform proposal_denied(format('select decide_project_proposal(%L,%L,%L,''admin'',''rejected'',''no'')',org,proposal,actor),'PROPOSAL_CONFLICT');
 if (select count(*) from projects)<>1 or (select count(*) from project_clients)<>1 or (select count(*) from notifications)<>1 or (select count(*) from proposal_decision_emails)<>1 then raise exception 'Replay duplicated state'; end if;
 if exists(select 1 from proposal_decision_emails e where to_jsonb(e)::text like '%PRIVATE%') then raise exception 'Client email leaked notes'; end if;
 -- Manager roster does not invent developer assignment. Acceptance and replay
 -- therefore create exactly one manager notice with real triggers installed.
 if exists(select 1 from projects where assigned_developer_id is not null) then raise exception 'Manager roster invented developer assignment'; end if;
 if (select count(*) from project_members where user_id=manager and user_type='developer' and project_role='manager')<>1 then raise exception 'Typed manager roster missing'; end if;
 if (select count(*) from notifications where developer_id=manager and title='A project has been assigned to you')<>1 then raise exception 'Manager notice lost or duplicated'; end if;
 -- Same person separately becomes assignee: one additional event, no repeat.
 update projects set assigned_developer_id=manager where id=(result->'project'->>'id')::uuid;
 update projects set assigned_developer_id=manager where id=(result->'project'->>'id')::uuid;
 perform decide_project_proposal(org,proposal,actor,'admin','accepted');
 if (select count(*) from notifications)<>2
  or (select count(*) from notifications where developer_id=manager and title='Project assigned')<>1
  or (select count(*) from notifications where developer_id=manager and title='A project has been assigned to you')<>1
 then raise exception 'Manager/assignee events duplicated across acceptance replay'; end if;

 select * into mail from claim_proposal_decision_emails(proposal);
 if mail.id is null or mail.attempts<>1 then raise exception 'Email not claimed'; end if;
 if exists(select 1 from claim_proposal_decision_emails(proposal)) then raise exception 'Active lease duplicated'; end if;
 if finish_proposal_decision_email(mail.id,gen_random_uuid(),true) then raise exception 'Stale lease acknowledged'; end if;
 if not finish_proposal_decision_email(mail.id,mail.lease_id,false) then raise exception 'Retry not retained'; end if;
 if exists(select 1 from claim_proposal_decision_emails(proposal)) then raise exception 'Backoff ignored'; end if;
 reset role;
 update proposal_decision_emails set next_attempt_at=now()-interval '1 minute';
 set local role service_role;
 select * into mail from claim_proposal_decision_emails(proposal);
 perform finish_proposal_decision_email(mail.id,mail.lease_id,true);
 if exists(select 1 from claim_proposal_decision_emails(proposal)) then raise exception 'Delivered email reclaimed'; end if;
 reset role;
 -- Retrying the same request for more information does not duplicate mail.
 proposal:=gen_random_uuid();
 insert into project_proposals(id,organization_id,client_id,title,description) values(proposal,org,client,'More info','Description');
 set local role service_role;
 perform decide_project_proposal(org,proposal,actor,'admin','needs_info','Clarify scope');
 result:=decide_project_proposal(org,proposal,actor,'admin','needs_info',' Clarify scope ');
 if result->>'replayed'<>'true' or (select count(*) from proposal_decision_emails where proposal_id=proposal)<>1 then raise exception 'Needs-info retry duplicated email'; end if;
 perform decide_project_proposal(org,proposal,actor,'admin','needs_info','Different public question');
 if (select count(*) from proposal_decision_emails where proposal_id=proposal)<>2 then raise exception 'New question was lost'; end if;
 reset role;
 -- A decline is terminal under the same lock and creates no project.
 proposal:=gen_random_uuid();
 insert into project_proposals(id,organization_id,client_id,title,description) values(proposal,org,client,'Declined','Description');
 set local role service_role;
 perform decide_project_proposal(org,proposal,actor,'admin','rejected','Not this quarter');
 perform proposal_denied(format('select decide_project_proposal(%L,%L,%L,''admin'',''accepted'')',org,proposal,actor),'PROPOSAL_CONFLICT');
 perform proposal_denied(format('select decide_project_proposal(%L,%L,%L,''admin'',''estimate'',null,null,null,1)',org,proposal,actor),'PROPOSAL_CONFLICT');
 reset role;
end $$;
rollback;
