begin;
-- Preserve unresolved historical identities rather than assigning a colliding UUID.
drop trigger if exists trg_time_log_week_lock on public.task_time_logs;
alter table public.task_time_logs add column user_type text check(user_type in ('admin','developer'));
update public.task_time_logs l set user_type=x.user_type from (
 select organization_id,user_id,min(user_type) user_type from public.memberships
 where user_type in ('admin','developer') group by organization_id,user_id having count(distinct user_type)=1
) x where l.organization_id=x.organization_id and l.developer_id=x.user_id and
 ((x.user_type='admin' and exists(select 1 from public.admin_users p where p.organization_id=x.organization_id and p.id=x.user_id))
 or (x.user_type='developer' and exists(select 1 from public.developers p where p.organization_id=x.organization_id and p.id=x.user_id)));
drop index if exists public.uq_time_logs_one_active_per_dev;
create unique index uq_time_logs_one_active_typed on public.task_time_logs(organization_id,user_type,developer_id) where ended_at is null;
alter table public.timesheets drop constraint timesheets_one_per_week;
alter table public.timesheets add constraint timesheets_one_per_week unique(organization_id,user_id,user_type,week_start);
alter table public.timesheets add column decided_by_type text check(decided_by_type in ('admin','developer'));

create function public.auth_timesheet_permission(p_key text) returns boolean
language sql stable security invoker set search_path=pg_catalog,public as $$
 select auth.uid() is not null and public.auth_org() is not null
 and auth.jwt()->'app_metadata'->>'user_type' in ('admin','developer')
 and coalesce(public.auth_override(p_key),case when p_key='timesheet.view_all' then public.auth_role() in ('owner','admin','manager','team_lead','finance')
 when p_key='timesheet.approve' then public.auth_role() in ('owner','admin','manager','team_lead')
 when p_key in ('timesheet.view_own','timesheet.submit_own','timesheet.log_own') then public.auth_role() in ('owner','admin','manager','team_lead','hr','qa','developer','designer','devops','employee','finance') else false end,false);
$$;
revoke all on function public.auth_timesheet_permission(text) from public,anon;
grant execute on function public.auth_timesheet_permission(text) to authenticated;
-- Status/snapshots are mutated exclusively by the validated transactional RPCs.
revoke insert,update,delete on public.timesheets from authenticated,anon;
drop policy if exists timesheets_read on public.timesheets;
drop policy if exists timesheets_write_own on public.timesheets;
drop policy if exists timesheets_decide on public.timesheets;
create policy timesheets_typed_read on public.timesheets for select to authenticated using(organization_id=public.auth_org() and
 (public.auth_timesheet_permission('timesheet.view_all') or (user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type' and public.auth_timesheet_permission('timesheet.view_own'))));
create policy timesheets_typed_guard on public.timesheets as restrictive for select to authenticated using(organization_id=public.auth_org() and
 (public.auth_timesheet_permission('timesheet.view_all') or (user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type' and public.auth_timesheet_permission('timesheet.view_own'))));

create or replace function public.timesheet_week_locked() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare previous jsonb; nextrow jsonb; r jsonb; org uuid; kind text; actor uuid:=public.auth_app_user_id(); actor_type text:=auth.jwt()->'app_metadata'->>'user_type';
begin
 if tg_op='DELETE' and not exists(select 1 from public.organizations where id=old.organization_id) then return old; end if;
 if tg_op='INSERT' and new.user_type is null and new.developer_id=actor and actor_type in ('admin','developer') then new.user_type:=actor_type; end if;
 if tg_op<>'INSERT' then previous:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then nextrow:=to_jsonb(new); end if;
 -- Same organization lock serializes log edits with submission, even when no
 -- timesheet row exists yet. Moving out of a locked week checks OLD and NEW.
 for org in select distinct (v->>'organization_id')::uuid from unnest(array[previous,nextrow]) v where v is not null order by 1 loop
  perform app_private.lock_quota(org);
 end loop;
 if tg_op='DELETE' and app_private.organization_deleting(old.organization_id) then return old; end if;
 if not app_private.org_unlocked((coalesce(nextrow,previous)->>'organization_id')::uuid) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 foreach r in array array[previous,nextrow] loop
  if r is null then continue; end if;
  if exists(select 1 from public.timesheets t where t.organization_id=(r->>'organization_id')::uuid and t.user_id=(r->>'developer_id')::uuid
   and (r->>'user_type' is null or t.user_type=r->>'user_type') and t.week_start=public.timesheet_week_of((r->>'started_at')::timestamptz) and t.status in ('submitted','approved')) then
   raise exception 'TIMESHEET_WEEK_LOCKED' using errcode='55000'; end if;
 end loop;
 if tg_op<>'DELETE' then
  if new.user_type is null then
   if tg_op='INSERT' and new.developer_id=actor and actor_type in ('admin','developer') then new.user_type:=actor_type;
   else raise exception 'TIMESHEET_IDENTITY_REVIEW_REQUIRED' using errcode='55000'; end if;
  end if;
  if tg_op='UPDATE' and (new.organization_id,new.developer_id,new.user_type) is distinct from (old.organization_id,old.developer_id,old.user_type) then
   raise exception 'TIMESHEET_LOG_IDENTITY_IMMUTABLE' using errcode='42501'; end if;
  if not exists(select 1 from public.memberships m where m.organization_id=new.organization_id and m.user_id=new.developer_id and m.user_type=new.user_type and m.status='active')
   or not ((new.user_type='admin' and exists(select 1 from public.admin_users p where p.id=new.developer_id and p.organization_id=new.organization_id))
   or (new.user_type='developer' and exists(select 1 from public.developers p where p.id=new.developer_id and p.organization_id=new.organization_id))) then
   raise exception 'TIMESHEET_LOG_IDENTITY_INVALID' using errcode='42501'; end if;
  -- Validate new attribution; stopping an existing legacy timer does not
  -- reclassify or rewrite its historical work relationship.
  if tg_op='INSERT' or (new.task_id,new.project_id) is distinct from (old.task_id,old.project_id) then
   if new.project_id is not null and not exists(select 1 from public.projects p where p.id=new.project_id and p.organization_id=new.organization_id) then
    raise exception 'TIMESHEET_PROJECT_INVALID' using errcode='42501'; end if;
   if new.task_id is not null and not exists(select 1 from public.developer_tasks t where t.id=new.task_id and t.organization_id=new.organization_id
    and t.project_id is not distinct from new.project_id) then
    raise exception 'TIMESHEET_TASK_INVALID' using errcode='42501'; end if;
  end if;
  if not isfinite(new.started_at) or (new.ended_at is not null and (not isfinite(new.ended_at) or new.ended_at<new.started_at)) or new.seconds<0 then
   raise exception 'TIMESHEET_LOG_INVALID' using errcode='22023'; end if;
  if new.ended_at is null and exists(select 1 from public.task_time_logs l where l.organization_id=new.organization_id and l.developer_id=new.developer_id and l.user_type is null and l.ended_at is null and l.id<>new.id) then
   raise exception 'TIMESHEET_IDENTITY_REVIEW_REQUIRED' using errcode='55000'; end if;
 end if;
 if auth.uid() is not null and not (coalesce(public.auth_timesheet_permission('timesheet.log_own'),false)
  and coalesce((coalesce(nextrow,previous)->>'organization_id')::uuid=public.auth_org(),false)
  and ((coalesce(nextrow,previous)->>'developer_id')::uuid=actor and coalesce(case when tg_op<>'DELETE' then new.user_type else old.user_type end,'')=actor_type
    or public.auth_role() in ('owner','admin'))) then raise exception 'TIMESHEET_FORBIDDEN' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger trg_time_log_week_lock before insert or update or delete on public.task_time_logs for each row execute function public.timesheet_week_locked();
revoke all on function public.timesheet_week_locked() from public,anon,authenticated;
create policy time_logs_typed_read_guard on public.task_time_logs as restrictive for select to authenticated using(organization_id=public.auth_org() and
 (public.auth_timesheet_permission('timesheet.view_all') or (developer_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type' and public.auth_timesheet_permission('timesheet.view_own'))));

create function public.guard_timesheet_delete() returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
begin
 if not exists(select 1 from public.organizations where id=old.organization_id) then return old; end if;
 perform app_private.lock_quota(old.organization_id);
 if old.status in ('submitted','approved') and not app_private.organization_deleting(old.organization_id) then raise exception 'TIMESHEET_WEEK_LOCKED' using errcode='55000'; end if;
 return old;
end $$;
create trigger timesheet_delete_guard before delete on public.timesheets for each row execute function public.guard_timesheet_delete();
revoke all on function public.guard_timesheet_delete() from public,anon,authenticated;

create function public.submit_timesheet_week(p_week_start date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); actor uuid:=public.auth_app_user_id(); kind text:=auth.jwt()->'app_metadata'->>'user_type'; sheet public.timesheets%rowtype;
 total bigint; billable bigint; invalid boolean; unresolved boolean;
begin
 if not coalesce(public.auth_timesheet_permission('timesheet.submit_own'),false) then raise exception 'TIMESHEET_FORBIDDEN' using errcode='42501'; end if;
 if p_week_start is null or not isfinite(p_week_start) or extract(isodow from p_week_start)<>1 then raise exception 'TIMESHEET_WEEK_INVALID' using errcode='22023'; end if;
 perform app_private.lock_quota(org);
 if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 select * into sheet from public.timesheets where organization_id=org and user_id=actor and user_type=kind and week_start=p_week_start for update;
 if found and sheet.status not in ('draft','rejected') then raise exception 'TIMESHEET_STATE_CONFLICT' using errcode='55000'; end if;
 if exists(select 1 from public.task_time_logs l where l.organization_id=org and l.developer_id=actor and l.user_type is null and public.timesheet_week_of(l.started_at)=p_week_start) then
  raise exception 'TIMESHEET_IDENTITY_REVIEW_REQUIRED' using errcode='55000'; end if;
 if exists(select 1 from public.task_time_logs l where l.organization_id=org and l.developer_id=actor and l.user_type=kind and public.timesheet_week_of(l.started_at)=p_week_start and (l.ended_at is null or l.seconds is null)) then
  raise exception 'TIMESHEET_OPEN_LOGS' using errcode='22023'; end if;
 select sum(l.seconds),sum(case when l.is_billable then l.seconds else 0 end),bool_or(l.seconds<0) into total,billable,invalid
 from public.task_time_logs l where l.organization_id=org and l.developer_id=actor and l.user_type=kind and public.timesheet_week_of(l.started_at)=p_week_start;
 if coalesce(invalid,false) then raise exception 'TIMESHEET_LOG_INVALID' using errcode='22023'; end if;
 if coalesce(total,0)=0 then raise exception 'TIMESHEET_EMPTY' using errcode='22023'; end if;
 insert into public.timesheets(organization_id,user_id,user_type,week_start,status,total_seconds,billable_seconds,submitted_at,decided_by,decided_by_type,decided_at,decision_note)
 values(org,actor,kind,p_week_start,'submitted',total,billable,now(),null,null,null,null)
 on conflict(organization_id,user_id,user_type,week_start) do update set status='submitted',total_seconds=excluded.total_seconds,billable_seconds=excluded.billable_seconds,
 submitted_at=now(),decided_by=null,decided_by_type=null,decided_at=null,decision_note=null,updated_at=now() returning * into sheet;
 return to_jsonb(sheet);
end $$;
create function public.decide_timesheet(p_timesheet_id uuid,p_decision text,p_note text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); actor uuid:=public.auth_app_user_id(); kind text:=auth.jwt()->'app_metadata'->>'user_type'; sheet public.timesheets%rowtype;
begin
 if not coalesce(public.auth_timesheet_permission('timesheet.approve'),false) then raise exception 'TIMESHEET_FORBIDDEN' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('approved','rejected','reopen') or length(p_note)>2000 then raise exception 'TIMESHEET_DECISION_INVALID' using errcode='22023'; end if;
 perform app_private.lock_quota(org);
 if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 select * into sheet from public.timesheets where organization_id=org and id=p_timesheet_id for update;
 if not found then raise exception 'TIMESHEET_NOT_FOUND' using errcode='P0002'; end if;
 if sheet.user_id=actor and sheet.user_type=kind then raise exception 'TIMESHEET_SELF_DECISION' using errcode='42501'; end if;
 if (p_decision='reopen' and sheet.status='draft') or (p_decision<>'reopen' and sheet.status<>'submitted') then raise exception 'TIMESHEET_STATE_CONFLICT' using errcode='55000'; end if;
 update public.timesheets set status=case when p_decision='reopen' then 'draft' else p_decision end,decided_by=actor,decided_by_type=kind,decided_at=now(),
 decision_note=coalesce(p_note,case when p_decision='reopen' then 'Reopened for correction' else null end),updated_at=now() where id=sheet.id returning * into sheet;
 return to_jsonb(sheet);
end $$;
revoke all on function public.submit_timesheet_week(date),public.decide_timesheet(uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_timesheet_week(date),public.decide_timesheet(uuid,text,text) to authenticated;
commit;
