begin;
-- A single statement snapshot avoids multi-page export races with reopen/review.
create index if not exists timesheets_approved_export on public.timesheets(organization_id,week_start,id) where status='approved';
create function app_private.approved_time_export(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); result jsonb; invalid boolean; amount integer;
begin
 if auth.uid() is null or org is null or not coalesce(public.auth_timesheet_permission('timesheet.view_all'),false) then raise exception 'TIME_EXPORT_FORBIDDEN' using errcode='42501'; end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or extract(isodow from p_from)<>1 or extract(isodow from p_to)<>1 or p_to<p_from or p_to-p_from>84 then raise exception 'TIME_EXPORT_RANGE' using errcode='22023'; end if;
 with sheets as (
  select t.* from public.timesheets t where t.organization_id=org and t.status='approved' and t.week_start between p_from and p_to order by t.week_start,t.user_type,t.user_id,t.id limit 10001
 ), checked as (
  select s.*,coalesce(nullif(case when s.user_type='admin' then coalesce(to_jsonb(a)->>'name',to_jsonb(a)->>'username') else to_jsonb(d)->>'name' end,''),'Staff member') staff_name
  from sheets s left join public.admin_users a on s.user_type='admin' and a.id=s.user_id and a.organization_id=org
  left join public.developers d on s.user_type='developer' and d.id=s.user_id and d.organization_id=org
 ) select count(*),coalesce(bool_or(user_id is null or user_type is null or user_type not in ('admin','developer') or total_seconds is null or total_seconds<=0 or total_seconds>9007199254740991
   or decided_at is null or decided_by is null or decided_by_type is null or decided_by_type not in ('admin','developer') or updated_at is null),false),
  coalesce(jsonb_agg(jsonb_build_object('timesheet_id',id,'user_id',user_id,'user_type',user_type,'name',staff_name,'week_start',week_start,'approved_seconds',total_seconds,
   'approved_at',decided_at,'approved_by',decided_by,'approved_by_type',decided_by_type,'source_updated_at',updated_at) order by week_start,user_type,user_id,id),'[]'::jsonb)
 into amount,invalid,result from checked;
 if amount>10000 then raise exception 'TIME_EXPORT_TOO_LARGE' using errcode='54000'; end if;
 if invalid then raise exception 'TIME_EXPORT_SOURCE_INVALID' using errcode='55000'; end if;
 return jsonb_build_object('organization_id',org,'from_week',p_from,'to_week',p_to,'captured_at',statement_timestamp(),'count',amount,'rows',result);
end $$;
revoke all on function app_private.approved_time_export(date,date) from public,anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.approved_time_export(date,date) to authenticated;
create function public.approved_time_export(p_from date,p_to date) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public,app_private as $$select app_private.approved_time_export(p_from,p_to);$$;
revoke all on function public.approved_time_export(date,date) from public,anon;
grant execute on function public.approved_time_export(date,date) to authenticated;
commit;
