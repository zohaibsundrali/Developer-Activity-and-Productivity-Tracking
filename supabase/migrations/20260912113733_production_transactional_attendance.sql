begin;
-- Ordinary staff record attendance through the server-clock RPC. Existing HR
-- correction writes remain available through their explicit manage permission.
drop policy if exists attendance_typed_insert on public.attendance_records;
drop policy if exists attendance_typed_update on public.attendance_records;
create policy attendance_typed_insert on public.attendance_records as restrictive for insert to authenticated with check(organization_id=public.auth_org() and public.auth_org_unlocked() and public.auth_attendance_permission('attendance.manage'));
create policy attendance_typed_update on public.attendance_records as restrictive for update to authenticated using(organization_id=public.auth_org() and public.auth_org_unlocked() and public.auth_attendance_permission('attendance.manage'))
 with check(organization_id=public.auth_org() and public.auth_org_unlocked() and public.auth_attendance_permission('attendance.manage'));

create function public.lock_attendance_statement() returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); begin if org is not null then perform app_private.lock_quota(org); end if; return null; end $$;
create trigger aa_attendance_statement_lock before insert or update or delete on public.attendance_records for each statement execute function public.lock_attendance_statement();
revoke all on function public.lock_attendance_statement() from public,anon,authenticated;
create function public.guard_attendance_record() returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
begin
 perform app_private.lock_quota(new.organization_id);
 -- Preserve the leave system's historical records. The existing leave approval
 -- authority validates those writes; HR's ordinary records need an active target.
 if not (new.source='system' and new.status='on_leave' and exists(select 1 from public.leave_requests r where r.organization_id=new.organization_id and r.user_id=new.user_id and r.user_type=new.user_type and r.status='approved' and new.work_date between r.start_date and r.end_date and not (r.start_date=r.end_date and r.days=0.5))) and (tg_op='INSERT' or (new.user_id,new.user_type,new.organization_id) is distinct from (old.user_id,old.user_type,old.organization_id)) then
  if not exists(select 1 from public.memberships m where m.organization_id=new.organization_id and m.user_id=new.user_id and m.user_type=new.user_type and m.status='active' and not m.deletion_blocked)
   or not ((new.user_type='admin' and exists(select 1 from public.admin_users p where p.organization_id=new.organization_id and p.id=new.user_id))
    or (new.user_type='developer' and exists(select 1 from public.developers p where p.organization_id=new.organization_id and p.id=new.user_id))) then raise exception 'ATTENDANCE_TARGET_NOT_FOUND' using errcode='P0002'; end if;
 end if;
 if tg_op='INSERT' or (new.check_in_at,new.check_out_at,new.work_date) is distinct from (old.check_in_at,old.check_out_at,old.work_date) then
  if not isfinite(new.work_date) or (new.check_in_at is not null and not isfinite(new.check_in_at))
   or (new.check_out_at is not null and (new.check_in_at is null or not isfinite(new.check_out_at) or new.check_out_at<new.check_in_at)) then
   raise exception 'ATTENDANCE_INPUT_INVALID' using errcode='22023'; end if;
 end if;
 return new;
end $$;
create trigger attendance_record_authority before insert or update on public.attendance_records for each row execute function public.guard_attendance_record();
revoke all on function public.guard_attendance_record() from public,anon,authenticated;

create function public.record_attendance(p_action text,p_work_date date,p_user_id uuid default null,p_user_type text default null,p_status text default 'present',p_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); actor uuid:=public.auth_app_user_id(); actor_type text:=auth.jwt()->'app_metadata'->>'user_type';
 target uuid:=coalesce(p_user_id,actor); kind text:=p_user_type; managed boolean; matches integer; result public.attendance_records%rowtype; stamp timestamptz;
begin
 if auth.uid() is null or org is null or actor is null or actor_type is null or actor_type not in ('admin','developer') then raise exception 'ATTENDANCE_FORBIDDEN' using errcode='42501'; end if;
 if p_action is null or p_action not in ('check_in','check_out') or p_work_date is null or not isfinite(p_work_date)
  or (kind is not null and kind not in ('admin','developer')) or p_status is null or p_status not in ('present','remote','absent','holiday') or length(p_note)>500 then
  raise exception 'ATTENDANCE_INPUT_INVALID' using errcode='22023'; end if;
 if kind is null and target=actor then kind:=actor_type; end if;
 managed:=target is distinct from actor or kind is distinct from actor_type;
 if not coalesce(public.auth_attendance_permission(case when managed then 'attendance.manage' else 'attendance.log_own' end),false) then raise exception 'ATTENDANCE_FORBIDDEN' using errcode='42501'; end if;
 if not managed and p_status not in ('present','remote') then raise exception 'ATTENDANCE_INPUT_INVALID' using errcode='22023'; end if;
 perform app_private.lock_quota(org);
 if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 if kind is null then
  select count(distinct m.user_type),min(m.user_type) into matches,kind from public.memberships m where m.organization_id=org and m.user_id=target and m.user_type in ('admin','developer') and m.status='active' and not m.deletion_blocked;
  if matches>1 then raise exception 'ATTENDANCE_TARGET_AMBIGUOUS' using errcode='22023'; end if;
 end if;
 if kind is null or not exists(select 1 from public.memberships m where m.organization_id=org and m.user_id=target and m.user_type=kind and m.status='active' and not m.deletion_blocked)
  or not ((kind='admin' and exists(select 1 from public.admin_users p where p.organization_id=org and p.id=target))
   or (kind='developer' and exists(select 1 from public.developers p where p.organization_id=org and p.id=target))) then raise exception 'ATTENDANCE_TARGET_NOT_FOUND' using errcode='P0002'; end if;
 select * into result from public.attendance_records where organization_id=org and user_id=target and user_type=kind and work_date=p_work_date for update;
 if p_action='check_out' then
  if not found or result.check_in_at is null then raise exception 'ATTENDANCE_NO_CHECK_IN' using errcode='55000'; end if;
  if result.check_out_at is not null then return jsonb_build_object('record',to_jsonb(result),'unchanged',true); end if;
  stamp:=greatest(clock_timestamp(),result.check_in_at);
  update public.attendance_records set check_out_at=stamp,updated_at=stamp where id=result.id returning * into result;
 else
  if found then return jsonb_build_object('record',to_jsonb(result),'unchanged',true); end if;
  stamp:=clock_timestamp();
  insert into public.attendance_records(organization_id,user_id,user_type,work_date,check_in_at,status,source,note,recorded_by)
  values(org,target,kind,p_work_date,case when p_status in ('absent','holiday') then null else stamp end,p_status,case when managed then 'hr' else 'self' end,p_note,actor) returning * into result;
 end if;
 return jsonb_build_object('record',to_jsonb(result),'unchanged',false);
end $$;
revoke all on function public.record_attendance(text,date,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_attendance(text,date,uuid,text,text,text) to authenticated;
commit;
