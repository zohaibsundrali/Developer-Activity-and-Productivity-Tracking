begin;
create function public.auth_leave_permission(p_key text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.memberships m where m.organization_id=public.auth_org() and m.user_id=public.auth_app_user_id()
  and m.user_type=auth.jwt()->'app_metadata'->>'user_type' and m.status='active' and m.user_type in ('admin','developer') and m.role<>'client')
 and case when p_key in ('leave.view_own','leave.request_own') then coalesce(public.auth_override(p_key),true)
  when p_key in ('leave.view_all','leave.approve') then coalesce(public.auth_override(p_key),public.auth_role() in ('owner','admin','hr','manager'),false) else false end;
$$;
revoke all on function public.auth_leave_permission(text) from public,anon;
grant execute on function public.auth_leave_permission(text) to authenticated;
drop policy if exists leave_requests_read on public.leave_requests;
drop policy if exists leave_requests_write_own on public.leave_requests;
drop policy if exists leave_requests_decide on public.leave_requests;
create policy leave_requests_read on public.leave_requests for select to authenticated using(organization_id=public.auth_org()
 and (public.auth_leave_permission('leave.view_all') or (user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type' and public.auth_leave_permission('leave.view_own'))));
create policy leave_requests_insert on public.leave_requests for insert to authenticated with check(organization_id=public.auth_org() and user_id=public.auth_app_user_id()
 and user_type=auth.jwt()->'app_metadata'->>'user_type' and status='pending' and public.auth_leave_permission('leave.request_own') and public.auth_org_unlocked());
create policy leave_requests_update on public.leave_requests for update to authenticated using(organization_id=public.auth_org() and status='pending' and public.auth_org_unlocked()
 and (public.auth_leave_permission('leave.approve') or (user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type' and public.auth_leave_permission('leave.request_own'))))
 with check(organization_id=public.auth_org() and public.auth_org_unlocked());
-- No browser DELETE policy: withdrawal remains the auditable cancelled state.
create function public.guard_leave_request() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare mine boolean; trusted boolean:=current_user in ('postgres','service_role','supabase_admin');
begin
 if tg_op='UPDATE' and row(new.id,new.organization_id,new.user_id,new.user_type,new.leave_type_id) is distinct from row(old.id,old.organization_id,old.user_id,old.user_type,old.leave_type_id) then
  raise exception 'Leave identity is immutable' using errcode='42501'; end if;
 if tg_op='INSERT' or row(new.start_date,new.end_date,new.days) is distinct from row(old.start_date,old.end_date,old.days) then
  if new.start_date is null or new.end_date is null or new.end_date<new.start_date or new.end_date-new.start_date>=365 or new.days is null
   or new.days::text in ('NaN','Infinity','-Infinity') or new.days<=0 or new.days>new.end_date-new.start_date+1 then
   raise exception 'Invalid leave dates or day amount' using errcode='22023'; end if;
 end if;
 if tg_op='INSERT' and (not exists(select 1 from public.leave_types t where t.id=new.leave_type_id and t.organization_id=new.organization_id and t.active)
  or not exists(select 1 from public.memberships m where m.organization_id=new.organization_id and m.user_id=new.user_id and m.user_type=new.user_type and m.status='active' and m.role<>'client')) then
  raise exception 'Leave type and staff member must be active in this organization' using errcode='42501'; end if;
 if not trusted then
  mine:=new.user_id=public.auth_app_user_id() and new.user_type=auth.jwt()->'app_metadata'->>'user_type';
  if tg_op='INSERT' then
   if new.status<>'pending' or not mine or not public.auth_leave_permission('leave.request_own') then raise exception 'Leave must be requested for yourself as pending' using errcode='42501'; end if;
   new.decided_by:=null; new.decided_at:=null; new.decision_note:=null;
  else
   if old.status<>'pending' then raise exception 'Leave was already decided' using errcode='40001'; end if;
   if new.status in ('approved','rejected') then
    if mine or not public.auth_leave_permission('leave.approve') then raise exception 'Leave decision permission required; self-approval is forbidden' using errcode='42501'; end if;
   elsif new.status='cancelled' then
    if not ((mine and public.auth_leave_permission('leave.request_own')) or (not mine and public.auth_leave_permission('leave.approve'))) then raise exception 'Leave cancellation not permitted' using errcode='42501'; end if;
   elsif new.status='pending' then
    if not mine or not public.auth_leave_permission('leave.request_own') then raise exception 'Only the requester may edit pending leave' using errcode='42501'; end if;
   else raise exception 'Invalid leave status' using errcode='22023'; end if;
   if new.status<>'pending' and row(new.start_date,new.end_date,new.days,new.reason) is distinct from row(old.start_date,old.end_date,old.days,old.reason) then raise exception 'A decision cannot rewrite the request' using errcode='42501'; end if;
   if new.status='pending' then new.decided_by:=null; new.decided_at:=null; new.decision_note:=null;
   else new.decided_by:=public.auth_app_user_id(); new.decided_at:=now(); end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_leave_request() from public,anon,authenticated;
create trigger aa_leave_request_authority before insert or update on public.leave_requests for each row execute function public.guard_leave_request();
-- Serialize requests for a typed person before checking overlap. The query
-- after this transaction lock sees the preceding committed request.
create or replace function public.leave_no_overlap() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if new.status not in ('pending','approved') then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||':'||new.user_type||':'||new.user_id::text,617));
 if exists(select 1 from public.leave_requests r where r.organization_id=new.organization_id and r.user_id=new.user_id and r.user_type=new.user_type
  and r.id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid) and r.status in ('pending','approved') and r.start_date<=new.end_date and r.end_date>=new.start_date) then
  raise exception 'Overlapping leave: pending or approved request already covers these dates' using errcode='23505'; end if;
 return new;
end $$;
revoke all on function public.leave_no_overlap() from public,anon,authenticated;
-- Attendance must use the same typed identity as the approving leave request.
alter table public.attendance_records drop constraint if exists attendance_one_per_day;
create unique index attendance_typed_day on public.attendance_records(organization_id,user_type,user_id,work_date);
create or replace function public.leave_apply_to_attendance() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare d date;
begin
 if new.status<>'approved' or (tg_op='UPDATE' and old.status='approved') then return new; end if;
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
create function public.auth_attendance_permission(k text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.memberships m where m.organization_id=public.auth_org() and m.user_id=public.auth_app_user_id()
  and m.user_type=auth.jwt()->'app_metadata'->>'user_type' and m.status='active' and m.user_type in ('admin','developer') and m.role<>'client')
 and case when k in ('attendance.view_own','attendance.log_own') then coalesce(public.auth_override(k),true)
 when k='attendance.view_all' then coalesce(public.auth_override(k),public.auth_role() in ('owner','admin','hr','manager'),false)
 when k='attendance.manage' then coalesce(public.auth_override(k),public.auth_role() in ('owner','admin','hr'),false) else false end;
$$;
revoke all on function public.auth_attendance_permission(text) from public,anon;
grant execute on function public.auth_attendance_permission(text) to authenticated;
drop policy if exists attendance_read on public.attendance_records;
drop policy if exists attendance_write_own on public.attendance_records;
drop policy if exists attendance_write_hr on public.attendance_records;
create policy attendance_effective_access on public.attendance_records for all to authenticated using(organization_id=public.auth_org()) with check(organization_id=public.auth_org());
create policy attendance_typed_read on public.attendance_records as restrictive for select to authenticated using(organization_id=public.auth_org()
 and (public.auth_attendance_permission('attendance.view_all') or (user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type' and public.auth_attendance_permission('attendance.view_own'))));
create policy attendance_typed_insert on public.attendance_records as restrictive for insert to authenticated with check(organization_id=public.auth_org() and public.auth_org_unlocked()
 and (public.auth_attendance_permission('attendance.manage') or (user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type' and public.auth_attendance_permission('attendance.log_own'))));
create policy attendance_typed_update on public.attendance_records as restrictive for update to authenticated using(organization_id=public.auth_org() and public.auth_org_unlocked()
 and (public.auth_attendance_permission('attendance.manage') or (user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type' and public.auth_attendance_permission('attendance.log_own'))))
 with check(organization_id=public.auth_org() and public.auth_org_unlocked() and (public.auth_attendance_permission('attendance.manage') or (user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type' and public.auth_attendance_permission('attendance.log_own'))));
create policy attendance_typed_delete on public.attendance_records as restrictive for delete to authenticated using(organization_id=public.auth_org() and public.auth_org_unlocked() and public.auth_attendance_permission('attendance.manage'));
create function public.guard_attendance_identity() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
 if row(new.id,new.organization_id,new.user_id,new.user_type,new.work_date) is distinct from row(old.id,old.organization_id,old.user_id,old.user_type,old.work_date) then
  raise exception 'Attendance identity and date are immutable' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_attendance_identity() from public,anon,authenticated;
create trigger attendance_identity before update on public.attendance_records for each row execute function public.guard_attendance_identity();
-- Keep existing balance semantics but never aggregate colliding profile IDs.
create or replace view public.leave_balances_v with(security_invoker=true) as
select lt.organization_id,r.user_id,lt.id as leave_type_id,lt.code,lt.name,extract(year from r.start_date)::int as leave_year,lt.annual_quota_days,
 coalesce(sum(r.days) filter(where r.status='approved'),0)::numeric(6,1) as taken_days,
 coalesce(sum(r.days) filter(where r.status='pending'),0)::numeric(6,1) as pending_days,
 case when lt.annual_quota_days is null then null else (lt.annual_quota_days-coalesce(sum(r.days) filter(where r.status='approved'),0))::numeric(6,1) end as remaining_days,
 r.user_type
from public.leave_requests r join public.leave_types lt on lt.id=r.leave_type_id and lt.organization_id=r.organization_id
 group by lt.organization_id,r.user_id,r.user_type,lt.id,lt.code,lt.name,extract(year from r.start_date),lt.annual_quota_days;
commit;
