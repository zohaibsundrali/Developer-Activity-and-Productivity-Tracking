\ir transactional_timesheet_review.sql
create table employee_profiles(organization_id uuid,user_id uuid,user_type text,primary key(organization_id,user_id,user_type));
create table invoices(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id) on delete cascade,
 project_id uuid references projects(id),client_id uuid references clients(id),number text not null,title text,amount numeric(12,2) not null default 0,currency text default 'USD',status text default 'draft',issued_at timestamptz,due_at timestamptz,pdf_path text,notes text,created_by uuid,created_at timestamptz default now());
alter table invoices enable row level security;
create policy invoices_admin on invoices for all to authenticated using(organization_id=auth_org() and not auth_is_client()) with check(organization_id=auth_org() and not auth_is_client());
create policy invoices_client_read on invoices for select to authenticated using(organization_id=auth_org() and auth_is_client() and client_id=auth_app_user_id() and status<>'draft');
grant all on invoices to authenticated,service_role;
\ir ../../database/079_invoicing_and_pnl.sql
grant all on invoice_lines to authenticated,service_role;
-- Legacy evidence: one colliding UUID and one provably unambiguous owner.
insert into projects(id,organization_id,name,default_bill_rate) values('99300000-0000-0000-0000-000000000002','99100000-0000-0000-0000-000000000001','Legacy invoice project',50);
insert into invoices(id,organization_id,project_id,number,amount,status) values('99400000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000001','99300000-0000-0000-0000-000000000002','Legacy',2,'sent');
insert into invoice_lines(organization_id,invoice_id,description,quantity,unit_rate,amount,source,project_id,user_id,week_start) values
 ('99100000-0000-0000-0000-000000000001','99400000-0000-0000-0000-000000000001','Ambiguous',1,1,1,'timesheet','99300000-0000-0000-0000-000000000002','99100000-0000-0000-0000-000000000011','2026-11-02'),
 ('99100000-0000-0000-0000-000000000001','99400000-0000-0000-0000-000000000001','Unambiguous',1,1,1,'timesheet','99300000-0000-0000-0000-000000000002','99100000-0000-0000-0000-000000000012','2026-11-02');
create table storage.buckets(id text primary key,public boolean not null default false);
insert into storage.buckets values('invoices',false);
\ir ../../supabase/migrations/20260912110551_production_transactional_typed_invoicing.sql
do $$ begin if (select user_type from invoice_lines where description='Ambiguous') is not null or (select user_type from invoice_lines where description='Unambiguous') is distinct from 'admin' then raise exception 'Legacy invoice identity guessed/lost'; end if; end $$;
delete from user_permissions where permission_key='timesheet.approve';
insert into projects(id,organization_id,name,default_bill_rate) values('99300000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000001','Invoice project',50);
insert into project_members(project_id,organization_id,user_id,user_type,bill_rate) values
 ('99300000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','developer',100),
 ('99300000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','admin',200);
insert into employee_profiles values('99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','developer',10),('99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','admin',20);
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
insert into task_time_logs(organization_id,developer_id,project_id,started_at,ended_at,seconds) values(auth_org(),auth_app_user_id(),'99300000-0000-0000-0000-000000000001','2026-10-05T10:00Z','2026-10-05T11:00Z',3600);
select submit_timesheet_week('2026-10-05');
select timesheet_expect('select * from project_pnl_v','permission denied');
select timesheet_expect('select * from billable_hours_v','permission denied');
select timesheet_expect('select raise_timesheet_invoice(''99300000-0000-0000-0000-000000000001'',''[]'')','INVOICE_FORBIDDEN');
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('admin'),false);
set role authenticated;
select decide_timesheet((select id from timesheets where user_type='developer' and week_start='2026-10-05'),'approved',null);
insert into task_time_logs(organization_id,developer_id,project_id,started_at,ended_at,seconds) values(auth_org(),auth_app_user_id(),'99300000-0000-0000-0000-000000000001','2026-10-05T10:00Z','2026-10-05T12:00Z',7200);
select submit_timesheet_week('2026-10-05');
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
set role authenticated;
select decide_timesheet((select id from timesheets where user_type='admin' and week_start='2026-10-05'),'approved',null);
reset role;
create function invoice_test_selections(kind text default null) returns jsonb language sql as $$
 select coalesce(jsonb_agg(jsonb_build_object('userId','99100000-0000-0000-0000-000000000011','userType',x,'weekStart','2026-10-05')),'[]') from unnest(case when kind is null then array['developer','admin'] else array[kind] end) x $$;
do $$ begin
 if (select sum(hours) from billable_hours_v where project_id='99300000-0000-0000-0000-000000000001')<>3 then raise exception 'Typed hours duplicated'; end if;
 if (select cost from project_pnl_v where project_id='99300000-0000-0000-0000-000000000001')<>50 then raise exception 'Typed cost incorrect'; end if;
 if bill_rate_for('99300000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011') is not null then raise exception 'Untyped rate guesses collision'; end if;
end $$;
set role authenticated;
do $$ declare result jsonb; original uuid; count_before int; other uuid; line uuid; begin
 select count(*) into count_before from invoices;
 perform timesheet_expect('select raise_timesheet_invoice(''99300000-0000-0000-0000-000000000001'',invoice_test_selections(''developer'')||invoice_test_selections(''developer''))','INVOICE_SELECTION_INVALID');
 if (select count(*) from invoices)<>count_before then raise exception 'Failed request left header'; end if;
 result:=raise_timesheet_invoice('99300000-0000-0000-0000-000000000001',invoice_test_selections());
 if (result->>'total')::numeric<>500 or (result->>'lines')::int<>2 or (result->'invoice'->>'amount')::numeric<>500 then raise exception 'Typed invoice amount wrong %',result; end if;
 original:=(result->'invoice'->>'id')::uuid;
 perform timesheet_expect('select raise_timesheet_invoice(''99300000-0000-0000-0000-000000000001'',invoice_test_selections(''developer''))','INVOICE_ALREADY_BILLED');
 perform timesheet_expect(format('update invoices set currency=''EUR'' where id=%L',original),'INVOICE_TIMESHEET_CURRENCY_INVALID');
 perform timesheet_expect(format('update invoice_lines set amount=1 where invoice_id=%L',original),'INVOICE_TIMESHEET_LINE_IMMUTABLE');
 update invoices set status='void' where id=original;
 perform raise_timesheet_invoice('99300000-0000-0000-0000-000000000001',invoice_test_selections('developer'));
 perform timesheet_expect(format('update invoices set status=''sent'' where id=%L',original),'INVOICE_ALREADY_BILLED');
 insert into invoices(organization_id,number,amount) values(auth_org(),'Manual A',999) returning id into original;
 insert into invoices(organization_id,number,amount) values(auth_org(),'Manual B',0) returning id into other;
 insert into invoice_lines(organization_id,invoice_id,description,quantity,unit_rate,amount,source) values(auth_org(),original,'Manual line',1,10,10,'manual') returning id into line;
 update invoice_lines set invoice_id=other where id=line;
 if (select amount from invoices where id=original)<>0 or (select amount from invoices where id=other)<>10 then raise exception 'Moved line totals incorrect'; end if;
 delete from invoice_lines where id=line;
 if (select amount from invoices where id=other)<>0 then raise exception 'Last-line deletion total stale'; end if;
 insert into invoices(organization_id,project_id,number,amount,currency) values(auth_org(),'99300000-0000-0000-0000-000000000001','EUR manual',20,'EUR');
end $$;
reset role;
do $$ begin
 if (select invoiced from project_pnl_v where project_id='99300000-0000-0000-0000-000000000001') is not null then raise exception 'Mixed currency added'; end if;
 if (select invoice_currency_totals->>'EUR' from project_pnl_v where project_id='99300000-0000-0000-0000-000000000001')<>'20.00' then raise exception 'Currency breakdown missing'; end if;
end $$;
-- Positive explicit overrides work even outside the default finance roles.
insert into user_permissions(membership_id,permission_key,allowed) select id,'invoice.manage',true from memberships where user_type='developer' and user_id='99100000-0000-0000-0000-000000000011';
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
insert into invoices(organization_id,number,amount) values(auth_org(),'Explicit-grant manual',1);
reset role;
update user_permissions set allowed=false where permission_key='invoice.manage';
set role authenticated;
do $$ begin if exists(select 1 from invoices) then raise exception 'Explicit denied employee reads invoices'; end if; end $$;
select timesheet_expect('insert into invoices(organization_id,number,amount) values(auth_org(),''Denied'',1)','INVOICE_FORBIDDEN');
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
begin;
-- Legacy ambiguous live billing blocks either typed identity from billing again.
select set_config('request.jwt.claims',timesheet_test_claims('developer'),true);
set local role authenticated;
insert into task_time_logs(organization_id,developer_id,project_id,started_at,ended_at,seconds) values(auth_org(),auth_app_user_id(),'99300000-0000-0000-0000-000000000002','2026-11-02T10:00Z','2026-11-02T11:00Z',3600);
select submit_timesheet_week('2026-11-02');
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('owner'),true);
set local role authenticated;
select decide_timesheet((select id from timesheets where week_start='2026-11-02' and user_type='developer'),'approved',null);
select timesheet_expect('select raise_timesheet_invoice(''99300000-0000-0000-0000-000000000002'',''[{"userId":"99100000-0000-0000-0000-000000000011","userType":"developer","weekStart":"2026-11-02"}]'')','INVOICE_ALREADY_BILLED');
reset role;
rollback;
-- Existing permissive storage policy cannot expose invoice PDFs to employees.
begin;
insert into storage.objects(bucket_id,name) values('invoices','99100000-0000-0000-0000-000000000001/test.pdf');
select set_config('request.jwt.claims',timesheet_test_claims('developer'),true);
set local role authenticated;
do $$ begin if exists(select 1 from storage.objects where bucket_id='invoices') then raise exception 'Invoice storage employee leak'; end if; end $$;
select timesheet_expect('insert into storage.objects(bucket_id,name) values(''invoices'',''99100000-0000-0000-0000-000000000001/forged.pdf'')','new row violates row-level security');
reset role;
rollback;
-- Service-only aggregates/helpers remain available to server, not direct API users.
do $$ begin
 if has_table_privilege('authenticated','billable_hours_v','SELECT') or has_table_privilege('authenticated','project_pnl_v','SELECT')
  or has_function_privilege('authenticated','bill_rate_for(uuid,uuid,text)','EXECUTE') then raise exception 'Financial direct API bypass'; end if;
 if not has_table_privilege('service_role','billable_hours_v','SELECT') then raise exception 'Server view access lost'; end if;
end $$;
-- Addressed non-draft clients can read manual invoices without a project;
-- the same client loses direct reads when the portal feature is unavailable.
begin;
insert into clients(id,organization_id,auth_user_id) values('99500000-0000-0000-0000-000000000011','99100000-0000-0000-0000-000000000001','99500000-0000-0000-0000-000000000091'),
 ('99500000-0000-0000-0000-000000000012','99100000-0000-0000-0000-000000000001','99500000-0000-0000-0000-000000000092');
insert into memberships(organization_id,user_id,user_type,role,status) values('99100000-0000-0000-0000-000000000001','99500000-0000-0000-0000-000000000011','client','client','active');
insert into auth.users(id,raw_app_meta_data) values('99500000-0000-0000-0000-000000000091','{"organization_id":"99100000-0000-0000-0000-000000000001","app_user_id":"99500000-0000-0000-0000-000000000011","user_type":"client","role":"client"}');
insert into invoices(id,organization_id,client_id,number,amount,status) values
 ('99500000-0000-0000-0000-000000000021','99100000-0000-0000-0000-000000000001','99500000-0000-0000-0000-000000000011','Addressed',0,'sent'),
 ('99500000-0000-0000-0000-000000000022','99100000-0000-0000-0000-000000000001','99500000-0000-0000-0000-000000000011','Draft',0,'draft'),
 ('99500000-0000-0000-0000-000000000023','99100000-0000-0000-0000-000000000001','99500000-0000-0000-0000-000000000012','Other client',0,'sent');
insert into invoice_lines(organization_id,invoice_id,description,quantity,unit_rate,amount) select organization_id,id,'Client line',1,10,10 from invoices where id in ('99500000-0000-0000-0000-000000000021','99500000-0000-0000-0000-000000000022','99500000-0000-0000-0000-000000000023');
select set_config('request.jwt.claims','{"sub":"99500000-0000-0000-0000-000000000091","app_metadata":{"organization_id":"99100000-0000-0000-0000-000000000001","app_user_id":"99500000-0000-0000-0000-000000000011","user_type":"client","role":"client"}}',true);
set local role authenticated;
do $$ begin if (select count(*) from invoices)<>1 or (select count(*) from invoice_lines)<>1 then raise exception 'Client address/draft scope incorrect'; end if; end $$;
select set_config('test.automation_plan','no',true);
do $$ begin if exists(select 1 from invoices) or exists(select 1 from invoice_lines) then raise exception 'Client plan restriction bypass'; end if; end $$;
reset role;
rollback;
-- Organization lifecycle cleanup may remove lines before their parent header.
begin;
set local role service_role;
select start_organization_deletion('99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000012','admin','99100000-0000-0000-0000-000000000093','Timesheet fixture',repeat('e',64));
select set_config('request.jwt.claims','{}',true);
delete from invoice_lines where organization_id='99100000-0000-0000-0000-000000000001';
reset role;
rollback;
