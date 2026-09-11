create table project_members(id uuid primary key default gen_random_uuid(),organization_id uuid,project_id uuid,user_id uuid,user_type text,project_role text,allocation_pct integer,added_by uuid,created_at timestamptz default now(),updated_at timestamptz,unique(project_id,user_id));
alter table project_members enable row level security;
create policy project_members_read on project_members for select to authenticated using(organization_id=public.auth_org() and not public.auth_is_client());
grant select,insert,update,delete on project_members to authenticated;
insert into memberships(organization_id,user_id,user_type,role,status) values
('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','developer','manager','active'),
('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','developer','developer','active');
insert into projects(id,organization_id,name) values
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Managed'),
('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Unassigned');
insert into project_members(organization_id,project_id,user_id,user_type,project_role) values
('00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','developer','manager');
