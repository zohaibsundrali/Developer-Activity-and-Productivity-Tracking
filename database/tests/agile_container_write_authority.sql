\set ON_ERROR_STOP on
\ir task_relationship_integrity.sql
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
alter table sprints alter column id set default gen_random_uuid(),alter column status set default 'planned',
 add column name text,add column goal text,add column start_date date,add column end_date date;
alter table epics alter column id set default gen_random_uuid(),add column name text,add column description text,add column status text default 'open';
create function auth_org_unlocked() returns boolean language sql stable as $$ select coalesce(current_setting('test.agile_locked',true),'no')<>'yes' $$;
alter table projects enable row level security;
create policy project_org on projects for all to authenticated using(organization_id=auth_org()) with check(organization_id=auth_org());
-- Legacy invalid content exists before installation; unrelated edits stay usable.
insert into memberships values('79000000-0000-0000-0000-000000000001','79000000-0000-0000-0000-000000000011','admin','owner','active');
insert into projects(id,organization_id) values('79000000-0000-0000-0000-000000000101','79000000-0000-0000-0000-000000000001'),('79000000-0000-0000-0000-000000000102','79000000-0000-0000-0000-000000000002');
insert into sprints(id,organization_id,name,status,start_date,end_date) values('79000000-0000-0000-0000-000000000201','79000000-0000-0000-0000-000000000001','',null,'2026-09-20','2026-09-01');
\ir ../../supabase/migrations/20260911134709_production_agile_container_write_authority.sql
create function agile_expect_denied(command text) returns void language plpgsql security invoker as $$ begin
 begin execute command; exception when insufficient_privilege or check_violation then return; end;
 raise exception 'Expected denied agile write: %',command;
end $$;
do $$ declare org uuid:='79000000-0000-0000-0000-000000000001'; actor uuid:='79000000-0000-0000-0000-000000000011'; project uuid:='79000000-0000-0000-0000-000000000101'; sprint uuid; epic uuid; n int; begin
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','admin','app_metadata',jsonb_build_object('user_type','admin'))::text,true);
 set local role authenticated;
 update sprints set goal='Unrelated repair remains possible' where id='79000000-0000-0000-0000-000000000201';
 insert into sprints(organization_id,project_id,name,start_date,end_date) values(org,project,' Sprint ','2026-09-01','2026-09-20') returning id into sprint;
 insert into epics(organization_id,name) values(org,'Global epic') returning id into epic;
 if (select name from sprints where id=sprint)<>'Sprint' then raise exception 'Name normalization failed'; end if;
 update sprints set status='completed' where id=sprint;
 update sprints set status='planned' where id=sprint;
 update epics set status='done' where id=epic;
 update epics set status='open' where id=epic;
 perform agile_expect_denied(format('insert into sprints(organization_id,project_id,name) values(%L,%L,''Bad parent'')',org,'79000000-0000-0000-0000-000000000102'));
 perform agile_expect_denied(format('insert into epics(organization_id,name) values(%L,''   '')',org));
 perform agile_expect_denied(format('update sprints set end_date=''2026-08-01'' where id=%L',sprint));
 perform agile_expect_denied(format('update epics set status=null where id=%L',epic));
 -- Billing DELETE must fail just like INSERT/UPDATE, despite legacy ALL policy.
 perform set_config('test.agile_locked','yes',true);
 delete from epics where id=epic; get diagnostics n=row_count;
 if n<>0 then raise exception 'Locked plan deleted epic'; end if;
 update sprints set goal='Locked edit' where id=sprint; get diagnostics n=row_count;
 if n<>0 then raise exception 'Locked plan edited sprint'; end if;
 perform agile_expect_denied(format('insert into sprints(organization_id,name) values(%L,''Locked'')',org));
 perform set_config('test.agile_locked','no',true);
 reset role;
 insert into user_permissions values(actor,'admin','task.manage',false);
 set local role authenticated;
 delete from sprints where id=sprint; get diagnostics n=row_count;
 if n<>0 then raise exception 'Explicit deny bypassed'; end if;
 reset role;
 delete from user_permissions where user_id=actor;
 -- A UUID collision does not inherit the admin role or override.
 insert into memberships values(org,actor,'developer','developer','active');
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','developer','app_metadata',jsonb_build_object('user_type','developer'))::text,true);
 set local role authenticated;
 perform agile_expect_denied(format('insert into epics(organization_id,name) values(%L,''Unauthorized'')',org));
 reset role;
 insert into user_permissions values(actor,'developer','task.manage',true);
 set local role authenticated;
 insert into epics(organization_id,name) values(org,'Explicitly allowed');
 reset role;
 update memberships set status='suspended' where user_id=actor and user_type='developer';
 set local role authenticated;
 perform agile_expect_denied(format('insert into epics(organization_id,name) values(%L,''Suspended'')',org));
 reset role;
 -- Even trusted writes cannot create a cross-organization container reference.
 perform agile_expect_denied(format('insert into sprints(organization_id,project_id,name) values(%L,%L,''Bad service parent'')',org,'79000000-0000-0000-0000-000000000102'));
end $$;
