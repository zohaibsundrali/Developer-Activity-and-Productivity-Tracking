begin;
create table public.shift_attendance_reviews (
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
 shift_id uuid not null references public.work_shifts(id) on delete cascade,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{32}$'),
 late_grace integer not null check(late_grace between 0 and 120), early_grace integer not null check(early_grace between 0 and 120),
 decision text not null check(decision in ('acknowledged','excused','reopened')),
 reason text not null check(length(btrim(reason)) between 1 and 1000), evidence jsonb not null,
 actor_id uuid not null, actor_type text not null check(actor_type in ('admin','developer')), created_at timestamptz not null default clock_timestamp()
);
create index shift_attendance_reviews_latest on public.shift_attendance_reviews(organization_id,shift_id,created_at desc,id desc);
create index shift_attendance_reviews_shift on public.shift_attendance_reviews(shift_id);
alter table public.shift_attendance_reviews enable row level security;
revoke all on public.shift_attendance_reviews from public,anon,authenticated;
grant select on public.shift_attendance_reviews to authenticated;
create policy shift_attendance_reviews_read on public.shift_attendance_reviews for select to authenticated using(
 organization_id=(select public.auth_org()) and exists(select 1 from public.work_shifts s where s.id=shift_id and s.organization_id=shift_attendance_reviews.organization_id and s.status='published'));
-- Internal snapshot deliberately omits leave reasons, attendance notes and GPS.
-- Daily rows alone cannot reliably assign a clock to multiple shifts.
create function app_private.shift_attendance_snapshot(p_shift uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public,app_private as $$
 select jsonb_build_object('shift',jsonb_build_object('id',s.id,'organization_id',s.organization_id,'user_id',s.user_id,'user_type',s.user_type,'assignee_name',s.assignee_name,'title',s.title,'start_at',s.start_at,'end_at',s.end_at,'timezone',s.timezone,'status',s.status,'version',s.version),
 'attendance',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'work_date',a.work_date,'check_in_at',a.check_in_at,'check_out_at',a.check_out_at,'status',a.status) order by a.work_date,a.id) from public.attendance_records a where a.organization_id=s.organization_id and a.user_id=s.user_id and a.user_type=s.user_type and (a.work_date between (s.start_at at time zone s.timezone)::date-1 and (s.end_at at time zone s.timezone)::date+1 or (a.check_in_at<s.end_at and (a.check_out_at>s.start_at or (a.check_out_at is null and a.check_in_at>=s.start_at-interval '12 hours'))))),'[]'::jsonb),
 'leave',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'start_date',l.start_date,'end_date',l.end_date,'days',l.days) order by l.start_date,l.id) from public.leave_requests l where l.organization_id=s.organization_id and l.user_id=s.user_id and l.user_type=s.user_type and l.status='approved' and l.start_date<=((s.end_at-interval '1 microsecond') at time zone s.timezone)::date and l.end_date>=(s.start_at at time zone s.timezone)::date),'[]'::jsonb),
 'neighbours',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'start_at',n.start_at,'end_at',n.end_at) order by n.start_at,n.id) from public.work_shifts n where n.organization_id=s.organization_id and n.user_id=s.user_id and n.user_type=s.user_type and n.status='published' and n.id<>s.id and n.start_at<s.end_at+interval '48 hours' and n.end_at>s.start_at-interval '48 hours'),'[]'::jsonb))
 from public.work_shifts s where s.id=p_shift;
$$;
revoke all on function app_private.shift_attendance_snapshot(uuid) from public,anon,authenticated;
create function app_private.shift_attendance_report(p_from date,p_to date,p_scope text,p_late integer,p_early integer) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); own_id uuid:=public.auth_app_user_id(); kind text:=auth.jwt()->'app_metadata'->>'user_type'; result jsonb;
begin
 if auth.uid() is null or org is null or own_id is null or kind is null or kind not in ('admin','developer')
 or not coalesce(public.auth_attendance_permission(case when p_scope='all' then 'attendance.view_all' else 'attendance.view_own' end),false) then raise exception 'EXCEPTION_FORBIDDEN' using errcode='42501';end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>30 or p_scope is null or p_scope not in ('me','all') or p_late is null or p_early is null or p_late not between 0 and 120 or p_early not between 0 and 120 then raise exception 'EXCEPTION_INVALID' using errcode='22023';end if;
 with selected as (
 select s.id from public.work_shifts s where s.organization_id=org and s.status='published' and s.end_at<=statement_timestamp()
 and s.start_at>=p_from::timestamp at time zone 'UTC' and s.start_at<(p_to+1)::timestamp at time zone 'UTC'
 and (p_scope='all' or (s.user_id=own_id and s.user_type=kind)) order by s.start_at,s.id limit 501
 ), snapshots as materialized (select id,app_private.shift_attendance_snapshot(id) as snapshot from selected)
 select coalesce(jsonb_agg(jsonb_build_object('snapshot',snapshot,'fingerprint',md5(snapshot::text||':'||p_late||':'||p_early||':v1'),
 'reviews',coalesce((select jsonb_agg(to_jsonb(r)-'evidence' order by r.created_at desc,r.id desc) from (select * from public.shift_attendance_reviews where shift_id=snapshots.id and organization_id=org order by created_at desc,id desc limit 20) r),'[]'::jsonb)) order by snapshot->'shift'->>'start_at',id),'[]'::jsonb) into result from snapshots;
 if jsonb_array_length(result)>500 or octet_length(result::text)>5000000 then raise exception 'EXCEPTION_RANGE_TOO_LARGE' using errcode='54000';end if;
 return jsonb_build_object('organization_id',org,'from',p_from,'to',p_to,'scope',p_scope,'late_grace',p_late,'early_grace',p_early,'as_of',statement_timestamp(),'rows',result,
 'can_manage',coalesce(public.auth_attendance_permission('attendance.manage'),false) and coalesce(public.auth_attendance_permission('attendance.view_all'),false));
end$$;
revoke all on function app_private.shift_attendance_report(date,date,text,integer,integer) from public,anon;
grant execute on function app_private.shift_attendance_report(date,date,text,integer,integer) to authenticated;
create function public.shift_attendance_report(p_from date,p_to date,p_scope text,p_late integer,p_early integer) returns jsonb language sql security invoker set search_path=pg_catalog,public,app_private as $$select app_private.shift_attendance_report(p_from,p_to,p_scope,p_late,p_early);$$;
revoke all on function public.shift_attendance_report(date,date,text,integer,integer) from public,anon;
grant execute on function public.shift_attendance_report(date,date,text,integer,integer) to authenticated;
create function app_private.review_shift_attendance(p_id uuid,p_shift uuid,p_fingerprint text,p_late integer,p_early integer,p_decision text,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); actor uuid:=public.auth_app_user_id(); kind text:=auth.jwt()->'app_metadata'->>'user_type'; snapshot jsonb; previous public.shift_attendance_reviews%rowtype; saved public.shift_attendance_reviews%rowtype;
begin
 if auth.uid() is null or org is null or actor is null or kind is null or kind not in ('admin','developer') or not coalesce(public.auth_attendance_permission('attendance.manage'),false) or not coalesce(public.auth_attendance_permission('attendance.view_all'),false) then raise exception 'EXCEPTION_FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_shift is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{32}$' or p_late is null or p_early is null or p_late not between 0 and 120 or p_early not between 0 and 120 or p_decision is null or p_decision not in ('acknowledged','excused','reopened') or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'EXCEPTION_INVALID' using errcode='22023';end if;
 perform app_private.lock_quota(org);
 if public.auth_org() is distinct from org or not coalesce(public.auth_attendance_permission('attendance.manage'),false) or not coalesce(public.auth_attendance_permission('attendance.view_all'),false) then raise exception 'EXCEPTION_FORBIDDEN' using errcode='42501';end if;
 if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED';end if;
 select * into previous from public.shift_attendance_reviews where id=p_id;
 if found then
 if row(previous.organization_id,previous.shift_id,previous.fingerprint,previous.late_grace,previous.early_grace,previous.decision,previous.reason,previous.actor_id,previous.actor_type) is distinct from row(org,p_shift,p_fingerprint,p_late,p_early,p_decision,btrim(p_reason),actor,kind) then raise exception 'EXCEPTION_STALE' using errcode='40001';end if;
 return to_jsonb(previous)-'evidence';
 end if;
 perform 1 from public.work_shifts where id=p_shift and organization_id=org and status='published' and end_at<=clock_timestamp() for update;
 if not found then raise exception 'EXCEPTION_NOT_FOUND' using errcode='P0002';end if;
 snapshot:=app_private.shift_attendance_snapshot(p_shift);
 if md5(snapshot::text||':'||p_late||':'||p_early||':v1')<>p_fingerprint then raise exception 'EXCEPTION_STALE' using errcode='40001';end if;
 insert into public.shift_attendance_reviews(id,organization_id,shift_id,fingerprint,late_grace,early_grace,decision,reason,evidence,actor_id,actor_type) values(p_id,org,p_shift,p_fingerprint,p_late,p_early,p_decision,btrim(p_reason),snapshot,actor,kind) returning * into saved;
 return to_jsonb(saved)-'evidence';
end$$;
revoke all on function app_private.review_shift_attendance(uuid,uuid,text,integer,integer,text,text) from public,anon;
grant execute on function app_private.review_shift_attendance(uuid,uuid,text,integer,integer,text,text) to authenticated;
create function public.review_shift_attendance(p_id uuid,p_shift uuid,p_fingerprint text,p_late integer,p_early integer,p_decision text,p_reason text) returns jsonb language sql security invoker set search_path=pg_catalog,public,app_private as $$select app_private.review_shift_attendance(p_id,p_shift,p_fingerprint,p_late,p_early,p_decision,p_reason);$$;
revoke all on function public.review_shift_attendance(uuid,uuid,text,integer,integer,text,text) from public,anon;
grant execute on function public.review_shift_attendance(uuid,uuid,text,integer,integer,text,text) to authenticated;
commit;
