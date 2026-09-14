begin;
-- Requires current-profile authority, attendance permissions and org quota locks.
create table public.work_shifts (
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null, user_type text not null check(user_type in ('admin','developer')),
 assignee_name text not null, title text not null check(length(btrim(title)) between 1 and 120),
 start_at timestamptz not null, end_at timestamptz not null, timezone text not null,
 status text not null check(status in ('draft','published','cancelled')), note text not null default '' check(length(note)<=1000),
 version integer not null default 1 check(version>0), created_by uuid not null, created_by_type text not null,
 updated_by uuid not null, updated_by_type text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(isfinite(start_at) and isfinite(end_at) and end_at>start_at and end_at-start_at<=interval '48 hours')
);
create index work_shifts_org_start on public.work_shifts(organization_id,start_at,id);
create index work_shifts_person_active on public.work_shifts(organization_id,user_type,user_id,start_at,end_at) where status<>'cancelled';
create table public.work_shift_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 shift_id uuid not null references public.work_shifts(id) on delete cascade, version integer not null,
 actor_id uuid not null, actor_type text not null, previous jsonb, current jsonb not null, created_at timestamptz not null default now(),
 unique(shift_id,version)
);
create index work_shift_events_org on public.work_shift_events(organization_id,shift_id,version);
alter table public.work_shifts enable row level security;
alter table public.work_shift_events enable row level security;
revoke all on public.work_shifts,public.work_shift_events from public,anon,authenticated;
grant select on public.work_shifts,public.work_shift_events to authenticated;
create policy work_shifts_read on public.work_shifts for select to authenticated using(
 organization_id=(select public.auth_org()) and ((select public.auth_attendance_permission('attendance.view_all'))
 or (status<>'draft' and user_id=(select public.auth_app_user_id()) and user_type=(select auth.jwt()->'app_metadata'->>'user_type')
     and (select public.auth_attendance_permission('attendance.view_own')))));
create policy work_shift_events_read on public.work_shift_events for select to authenticated using(
 organization_id=(select public.auth_org()) and (select public.auth_attendance_permission('attendance.view_all')));

-- All writes go through one transaction. The organization lock is acquired before
-- row locks, so overlapping inserts/updates cannot both pass the conflict check.
create function app_private.save_work_shift(p_id uuid,p_version integer,p_user_id uuid,p_user_type text,
 p_start timestamptz,p_end timestamptz,p_timezone text,p_title text,p_status text,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); actor uuid:=public.auth_app_user_id(); kind text:=auth.jwt()->'app_metadata'->>'user_type';
 oldrow public.work_shifts%rowtype; saved public.work_shifts%rowtype; target_name text; old_json jsonb; stamp timestamptz;
begin
 if auth.uid() is null or org is null or actor is null or kind is null or kind not in ('admin','developer')
  or not coalesce(public.auth_attendance_permission('attendance.manage'),false)
  or not coalesce(public.auth_attendance_permission('attendance.view_all'),false) then
  raise exception 'SHIFT_FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_version is null or p_version<0 or p_version>=2147483647 or p_user_id is null or p_user_type is null or p_user_type not in ('admin','developer')
  or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<=p_start or p_end-p_start>interval '48 hours'
  or p_start<>date_trunc('minute',p_start) or p_end<>date_trunc('minute',p_end)
  or p_title is null or length(btrim(p_title)) not between 1 and 120 or p_note is null or length(p_note)>1000
  or p_status is null or p_status not in ('draft','published','cancelled')
  or p_timezone is null or length(p_timezone)>64 or not exists(select 1 from pg_timezone_names where name=p_timezone) then
  raise exception 'SHIFT_INPUT_INVALID' using errcode='22023'; end if;
 perform app_private.lock_quota(org);
 if public.auth_org() is distinct from org or not coalesce(public.auth_attendance_permission('attendance.manage'),false)
  or not coalesce(public.auth_attendance_permission('attendance.view_all'),false) then raise exception 'SHIFT_FORBIDDEN' using errcode='42501'; end if;
 if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 select * into oldrow from public.work_shifts where id=p_id and organization_id=org for update;
 if found then
  old_json:=to_jsonb(oldrow);
  -- Replaying the immediately committed request succeeds without a second audit.
  if oldrow.version=p_version+1 and oldrow.updated_by=actor and oldrow.updated_by_type=kind
   and row(oldrow.user_id,oldrow.user_type,oldrow.start_at,oldrow.end_at,oldrow.timezone,oldrow.title,oldrow.status,oldrow.note)
    is not distinct from row(p_user_id,p_user_type,p_start,p_end,p_timezone,btrim(p_title),p_status,p_note) then
   return jsonb_build_object('shift',old_json,'unchanged',true); end if;
  if oldrow.version<>p_version then raise exception 'SHIFT_STALE' using errcode='40001'; end if;
  -- A cancellation is retained as history. Create a new shift to replace it.
  if oldrow.status='cancelled' then raise exception 'SHIFT_CANCELLED' using errcode='55000'; end if;
 else
  if p_version<>0 then raise exception 'SHIFT_NOT_FOUND' using errcode='P0002'; end if;
  if p_status='cancelled' then raise exception 'SHIFT_INPUT_INVALID' using errcode='22023'; end if;
 end if;
 if p_status='cancelled' then
  if old_json is null or row(oldrow.user_id,oldrow.user_type,oldrow.start_at,oldrow.end_at,oldrow.timezone,oldrow.title,oldrow.note)
   is distinct from row(p_user_id,p_user_type,p_start,p_end,p_timezone,btrim(p_title),p_note) then raise exception 'SHIFT_INPUT_INVALID' using errcode='22023'; end if;
  target_name:=oldrow.assignee_name;
 else
  if not exists(select 1 from public.memberships m where m.organization_id=org and m.user_id=p_user_id and m.user_type=p_user_type
    and m.status='active' and not m.deletion_blocked and m.role<>'client') then raise exception 'SHIFT_TARGET_NOT_FOUND' using errcode='P0002'; end if;
  if p_user_type='admin' then select coalesce(nullif(to_jsonb(p)->>'name',''),nullif(to_jsonb(p)->>'username',''),'Staff member') into target_name from public.admin_users p where p.id=p_user_id and p.organization_id=org;
  else select coalesce(nullif(p.name,''),'Staff member') into target_name from public.developers p where p.id=p_user_id and p.organization_id=org; end if;
  if target_name is null then raise exception 'SHIFT_TARGET_NOT_FOUND' using errcode='P0002'; end if;
  if exists(select 1 from public.work_shifts s where s.organization_id=org and s.user_id=p_user_id and s.user_type=p_user_type
    and s.id<>p_id and s.status<>'cancelled' and s.start_at<p_end and s.end_at>p_start) then
    raise exception 'SHIFT_OVERLAP' using errcode='23P01'; end if;
 end if;
 stamp:=clock_timestamp();
 if old_json is null then
  insert into public.work_shifts(id,organization_id,user_id,user_type,assignee_name,title,start_at,end_at,timezone,status,note,
   created_by,created_by_type,updated_by,updated_by_type,created_at,updated_at)
  values(p_id,org,p_user_id,p_user_type,target_name,btrim(p_title),p_start,p_end,p_timezone,p_status,p_note,actor,kind,actor,kind,stamp,stamp) returning * into saved;
 else
  update public.work_shifts set user_id=p_user_id,user_type=p_user_type,assignee_name=target_name,title=btrim(p_title),start_at=p_start,end_at=p_end,
   timezone=p_timezone,status=p_status,note=p_note,version=version+1,updated_by=actor,updated_by_type=kind,updated_at=stamp
  where id=p_id and organization_id=org returning * into saved;
 end if;
 insert into public.work_shift_events(organization_id,shift_id,version,actor_id,actor_type,previous,current)
 values(org,p_id,saved.version,actor,kind,old_json,to_jsonb(saved));
 return jsonb_build_object('shift',to_jsonb(saved),'unchanged',false);
end $$;
revoke all on function app_private.save_work_shift(uuid,integer,uuid,text,timestamptz,timestamptz,text,text,text,text) from public,anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.save_work_shift(uuid,integer,uuid,text,timestamptz,timestamptz,text,text,text,text) to authenticated;
create function public.save_work_shift(p_id uuid,p_version integer,p_user_id uuid,p_user_type text,p_start timestamptz,p_end timestamptz,p_timezone text,p_title text,p_status text,p_note text default '')
returns jsonb language sql security invoker set search_path=pg_catalog,public,app_private as $$
 select app_private.save_work_shift(p_id,p_version,p_user_id,p_user_type,p_start,p_end,p_timezone,p_title,p_status,p_note);
$$;
revoke all on function public.save_work_shift(uuid,integer,uuid,text,timestamptz,timestamptz,text,text,text,text) from public,anon;
grant execute on function public.save_work_shift(uuid,integer,uuid,text,timestamptz,timestamptz,text,text,text,text) to authenticated;

create function app_private.work_shift_staff(p_search text,p_after_type text,p_after_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); result jsonb;
begin
 if auth.uid() is null or org is null or not coalesce(public.auth_attendance_permission('attendance.manage'),false)
  or not coalesce(public.auth_attendance_permission('attendance.view_all'),false) then raise exception 'SHIFT_FORBIDDEN' using errcode='42501'; end if;
 if p_search is null or length(p_search)>100 or (p_after_type is null)<>(p_after_id is null)
  or (p_after_type is not null and p_after_type not in ('admin','developer')) then raise exception 'SHIFT_INPUT_INVALID' using errcode='22023'; end if;
 with staff as (
  select m.user_id id,m.user_type,coalesce(nullif(to_jsonb(a)->>'name',''),nullif(to_jsonb(a)->>'username',''),'Staff member') name
  from public.memberships m join public.admin_users a on a.id=m.user_id and a.organization_id=m.organization_id
  where m.organization_id=org and m.user_type='admin' and m.status='active' and not m.deletion_blocked and m.role<>'client'
  union all
  select m.user_id,m.user_type,coalesce(nullif(d.name,''),'Staff member') from public.memberships m join public.developers d on d.id=m.user_id and d.organization_id=m.organization_id
  where m.organization_id=org and m.user_type='developer' and m.status='active' and not m.deletion_blocked and m.role<>'client'
 ), page as (
  select distinct id,user_type,name from staff where strpos(lower(name),lower(p_search))>0
   and (p_after_id is null or (user_type,id)>(p_after_type,p_after_id)) order by user_type,id limit 51
 ) select coalesce(jsonb_agg(to_jsonb(page) order by user_type,id),'[]'::jsonb) into result from page;
 return result;
end $$;
revoke all on function app_private.work_shift_staff(text,text,uuid) from public,anon;
grant execute on function app_private.work_shift_staff(text,text,uuid) to authenticated;
create function public.work_shift_staff(p_search text default '',p_after_type text default null,p_after_id uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog,public,app_private as $$ select app_private.work_shift_staff(p_search,p_after_type,p_after_id); $$;
revoke all on function public.work_shift_staff(text,text,uuid) from public,anon;
grant execute on function public.work_shift_staff(text,text,uuid) to authenticated;
commit;
