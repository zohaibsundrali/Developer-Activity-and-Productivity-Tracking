begin;
-- Preserve the existing MyLeave contract: calendar-day spans; only a single
-- calendar date may be a half-day. No holiday/workweek rule is introduced.
create function public.guard_leave_day_contract() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
 if tg_op='INSERT' or row(new.start_date,new.end_date,new.days) is distinct from row(old.start_date,old.end_date,old.days)
  or (new.status='approved' and old.status is distinct from 'approved') then
  if new.start_date=new.end_date then
   if new.days not in (0.5,1) or new.days is null then
    raise exception 'Single-date leave must be 0.5 or 1 day. Correct the request before approval.' using errcode='22023'; end if;
  elsif new.days is distinct from (new.end_date-new.start_date+1)::numeric then
   raise exception 'Multi-date leave must equal its full calendar-day span. Withdraw and resubmit the corrected request before approval.' using errcode='22023';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_leave_day_contract() from public,anon,authenticated;
create trigger ab_leave_day_contract before insert or update on public.leave_requests for each row execute function public.guard_leave_day_contract();
create or replace function public.leave_apply_to_attendance() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare d date;
begin
 if new.status<>'approved' or (tg_op='UPDATE' and old.status='approved') then return new; end if;
 -- Attendance has no fraction field. Do not overwrite a real check-in or create
 -- a false full-day absence for half-day leave. Its approved 0.5 remains in
 -- leave_requests and both capacity queries already account for that amount.
 if new.start_date=new.end_date and new.days=0.5 then return new; end if;
 d:=new.start_date;
 while d<=new.end_date loop
  insert into public.attendance_records(organization_id,user_id,user_type,work_date,status,source,note)
  values(new.organization_id,new.user_id,new.user_type,d,'on_leave','system','Approved leave #'||left(new.id::text,8))
  on conflict(organization_id,user_type,user_id,work_date) do update set status='on_leave',source='system',updated_at=now()
   where public.attendance_records.status in ('absent','on_leave');
  d:=d+1;
 end loop;
 return new;
end $$;
revoke all on function public.leave_apply_to_attendance() from public,anon,authenticated;
commit;
