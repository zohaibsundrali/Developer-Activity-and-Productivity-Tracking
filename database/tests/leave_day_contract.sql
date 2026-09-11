\set ON_ERROR_STOP on
\ir typed_leave_authority.sql
-- Legacy aggregate values are retained, but cannot become approved unchanged.
insert into leave_requests(id,organization_id,user_id,user_type,leave_type_id,start_date,end_date,days)
select '92000000-0000-0000-0000-000000000001',organization_id,'91000000-0000-0000-0000-000000000011','developer',id,'2028-01-01','2028-01-03',0.5 from leave_types limit 1;
\ir ../../supabase/migrations/20260911182229_production_existing_leave_day_contract.sql
do $$ declare org uuid:='91000000-0000-0000-0000-000000000001'; person uuid:='91000000-0000-0000-0000-000000000011'; lt uuid; leave_id uuid; begin
 select id into lt from leave_types limit 1;
 update leave_requests set reason='Legacy note remains editable' where id='92000000-0000-0000-0000-000000000001';
 perform leave_expect_denied('update leave_requests set status=''approved'' where id=''92000000-0000-0000-0000-000000000001''');
 perform leave_expect_denied(format('insert into leave_requests(organization_id,user_id,user_type,leave_type_id,start_date,end_date,days) values(%L,%L,''developer'',%L,''2028-02-01'',''2028-02-03'',0.5)',org,person,lt));
 perform leave_expect_denied(format('insert into leave_requests(organization_id,user_id,user_type,leave_type_id,start_date,end_date,days) values(%L,%L,''developer'',%L,''2028-02-01'',''2028-02-01'',0.25)',org,person,lt));
 insert into attendance_records(organization_id,user_id,user_type,work_date,status,source,note) values(org,person,'developer','2028-03-01','present','self','Real check-in');
 insert into leave_requests(organization_id,user_id,user_type,leave_type_id,start_date,end_date,days) values(org,person,'developer',lt,'2028-03-01','2028-03-01',.5) returning id into leave_id;
 update leave_requests set status='approved' where id=leave_id;
 if not exists(select 1 from attendance_records where work_date='2028-03-01' and status='present' and note='Real check-in') then raise exception 'Half day overwrote attendance'; end if;
 insert into leave_requests(organization_id,user_id,user_type,leave_type_id,start_date,end_date,days,status) values(org,person,'developer',lt,'2028-03-02','2028-03-02',.5,'approved');
 if exists(select 1 from attendance_records where work_date='2028-03-02') then raise exception 'Half day created a full-day attendance row'; end if;
 -- A Saturday/Sunday remains two calendar days under the existing UI contract.
 insert into leave_requests(organization_id,user_id,user_type,leave_type_id,start_date,end_date,days,status) values(org,person,'developer',lt,'2028-03-04','2028-03-05',2,'approved');
 if (select count(*) from attendance_records where work_date between '2028-03-04' and '2028-03-05' and status='on_leave')<>2 then raise exception 'Existing calendar span changed'; end if;
end $$;
