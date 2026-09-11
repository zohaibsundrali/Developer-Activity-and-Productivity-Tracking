-- Same isolated quota_test database; no real customer data.
create table automation_rules(id uuid primary key default gen_random_uuid(),organization_id uuid,enabled boolean default true);
grant select,insert,update,delete on automation_rules to authenticated;
create policy legacy_automation on automation_rules for all to authenticated using(true) with check(true);
alter table screenshots add column timestamp timestamptz default now();
create policy legacy_screenshots on screenshots for all to authenticated using(true) with check(true);
create policy legacy_projects on projects for all to authenticated using(true) with check(true);
