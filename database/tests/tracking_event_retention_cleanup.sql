\ir tracking_retention_jobs.sql
\ir ../../supabase/migrations/20260912094423_production_tracking_event_history_timestamps.sql
create table browser_usage(id integer primary key,organization_id uuid,site text,first_seen timestamptz,last_seen timestamptz,created_at timestamptz default now());
create table browser_evidence(browser_id integer references browser_usage(id));
insert into browser_usage values
 (1,'92000000-0000-0000-0000-000000000001','old.test',now()-interval '60 days',now()-interval '40 days',now()),
 (2,'92000000-0000-0000-0000-000000000001','open.test',now()-interval '60 days',null,now()),
 (3,'92000000-0000-0000-0000-000000000001','recent.test',now()-interval '60 days',now(),now()),
 (4,'92000000-0000-0000-0000-000000000001','evidence.test',now()-interval '60 days',now()-interval '40 days',now());
insert into browser_evidence values(4);
select set_config('test.deleting','no',false);
update tracking_retention_policies set mode='disabled',days=null where organization_id='92000000-0000-0000-0000-000000000001';
set role service_role;
select sweep_tracking_retention('92000000-0000-0000-0000-000000000001');
reset role;
do $$ begin if (select count(*) from browser_usage)<>4 then raise exception 'Disabled cleanup deleted browser history'; end if; end $$;
-- Isolated fixture opts in; production migration itself never enables cleanup.
update tracking_retention_policies set mode='custom',days=30 where organization_id='92000000-0000-0000-0000-000000000001';
set role service_role;
select sweep_tracking_retention('92000000-0000-0000-0000-000000000001');
reset role;
do $$ begin
 if exists(select 1 from browser_usage where id=1) then raise exception 'Old browser interval survived due to recent upload'; end if;
 if (select count(*) from browser_usage)<>3 then raise exception 'Open/recent/referenced browser row was deleted'; end if;
end $$;
