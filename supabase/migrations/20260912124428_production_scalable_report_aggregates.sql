begin;
-- Cache STABLE caller authority once per statement, not once per time-log row.
-- Keep the restrictive predicate and all existing monitoring policies unchanged.
alter policy time_logs_typed_read_guard on public.task_time_logs using(organization_id=(select public.auth_org()) and
 ((select public.auth_timesheet_permission('timesheet.view_all')) or (developer_id=(select public.auth_app_user_id()) and user_type=(select auth.jwt()->'app_metadata'->>'user_type') and (select public.auth_timesheet_permission('timesheet.view_own')))));
-- Invoker execution is essential: report aggregates retain every source RLS
-- policy, including typed time-log, monitoring and plan-history restrictions.
create function public.report_data(p_from date,p_to date,p_view text default 'overview',p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public set timezone='UTC' as $$
declare org uuid:=public.auth_org(); answer jsonb;
begin
 if auth.uid() is null or org is null or coalesce(auth.jwt()->'app_metadata'->>'user_type','') not in ('admin','developer')
 or not coalesce(public.auth_override('report.view'),public.auth_role() in ('owner','admin','manager','team_lead'),false) then raise exception 'REPORT_FORBIDDEN' using errcode='42501'; end if;
 if not coalesce(public.auth_plan_feature('reports'),false) then raise exception 'REPORT_PLAN_REQUIRED' using errcode='42501'; end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from<date '0001-01-01' or p_to>=date '9999-12-31' or p_to<p_from or p_to-p_from>3659 then raise exception 'REPORT_RANGE_INVALID' using errcode='22023'; end if;
 if p_view is null or p_view not in ('overview','projects','team','time','delays') or p_limit is null or p_limit not between 1 and 500 or p_offset is null or p_offset<0 then raise exception 'REPORT_INPUT_INVALID' using errcode='22023'; end if;
 with
 people as materialized (
 select m.user_id,m.user_type,m.role,coalesce(nullif(case when m.user_type='admin' then a.full_name else d.name end,''),nullif(split_part(m.email,'@',1),''),'Member') name,
 coalesce(case when m.user_type='admin' then a.email else d.email end,m.email,'') email
 from public.memberships m left join public.admin_users a on m.user_type='admin' and a.id=m.user_id and a.organization_id=org
 left join public.developers d on m.user_type='developer' and d.id=m.user_id and d.organization_id=org
 where m.organization_id=org and m.user_type in ('admin','developer')
 ), projects_source as materialized (select * from public.projects where organization_id=org),
 tasks as materialized (
 select t.*,case when t.status in ('completed','done','approved') then 'completed' when t.status in ('awaiting_approval','reviewed','in_review') then 'awaiting_approval' when t.status in ('in_progress','doing') then 'in_progress' when t.status='rejected' then 'rejected' else 'pending' end normalized,
 (coalesce(t.due_date::timestamptz,t.end_date::timestamptz) at time zone 'UTC')::date due,
 (coalesce(t.actual_completion_date::timestamptz,t.reviewed_at,t.updated_at) at time zone 'UTC')::date completed_on
 from public.developer_tasks t where t.organization_id=org
 ), logs as materialized (select * from public.task_time_logs where organization_id=org and started_at>=p_from::timestamp at time zone 'UTC' and started_at<(p_to+1)::timestamp at time zone 'UTC'),
 sessions as materialized (
 select s.* from public.productivity_sessions s where s.start_time>=p_from::timestamp at time zone 'UTC' and s.start_time<(p_to+1)::timestamp at time zone 'UTC'
 and exists(select 1 from people e where e.user_type='developer' and (s.user_id::text=e.user_id::text or s.user_email=e.email))
 ), session_people as materialized (
 select s.*,e.user_id person_id from sessions s join people e on e.user_type='developer' and
 (s.user_id::text=e.user_id::text or (nullif(s.user_id::text,'') is null and s.user_email=e.email and 1=(select count(*) from people x where x.user_type='developer' and x.email=s.user_email)))
 ), task_totals as (
 select count(*) total,count(*) filter(where normalized='completed') done,count(*) filter(where normalized='pending') pending,
 count(*) filter(where normalized='rejected') rejected,count(*) filter(where normalized='in_progress') in_progress,count(*) filter(where normalized='awaiting_approval') awaiting_approval,
 count(*) filter(where normalized<>'completed' and due<(now() at time zone 'UTC')::date) overdue from tasks
 ), project_stats as (
 select project_id,count(*) total,count(*) filter(where normalized='completed') done,count(*) filter(where normalized='in_progress') active,
 count(*) filter(where normalized<>'completed' and due<(now() at time zone 'UTC')::date) overdue,
 count(*) filter(where normalized='completed' and is_on_time is not null) rated,count(*) filter(where normalized='completed' and is_on_time) ontime from tasks group by project_id
 ), project_logs as (select project_id,sum(coalesce(seconds,0)) seconds from logs group by project_id),
 project_rows as materialized (
 select p.id::text key,coalesce(t.total,0) workload,jsonb_build_object('projectId',p.id,'project',coalesce(nullif(p.name,''),'Untitled'),'status',coalesce(nullif(p.status,''),'—'),
 'total',coalesce(t.total,0),'done',coalesce(t.done,0),'inProgress',coalesce(t.active,0),'pending',greatest(0,coalesce(t.total-t.done-t.active,0)),
 'overdue',coalesce(t.overdue,0),'progress',case when t.total>0 then round(100.0*t.done/t.total) else coalesce(p.progress,0) end,
 'onTimeRate',case when t.rated>0 then round(100.0*t.ontime/t.rated) end,'loggedHours',round(coalesce(l.seconds,0)/3600.0,2),
 'deadline',coalesce(p.end_date::date,p.deadline::date),'daysLate',case when coalesce(p.end_date::date,p.deadline::date)<(now() at time zone 'UTC')::date and t.total>t.done then (now() at time zone 'UTC')::date-coalesce(p.end_date::date,p.deadline::date) else 0 end) row
 from projects_source p left join project_stats t on t.project_id=p.id left join project_logs l on l.project_id=p.id
 ), person_tasks as (
 select developer_id,count(*) total,count(*) filter(where normalized='completed') done,count(*) filter(where normalized='completed' and is_on_time is not null) rated,
 count(*) filter(where normalized='completed' and is_on_time) ontime,sum(coalesce(productivity_points,0)) points from tasks group by developer_id
 ), person_logs as (select user_type,developer_id,sum(coalesce(seconds,0)) seconds from logs group by user_type,developer_id),
 person_sessions as (select person_id,sum(coalesce(total_duration,0)) seconds,avg(productivity_score) score from session_people group by person_id),
 team_rows as materialized (
 select e.user_type||':'||e.user_id key,coalesce(t.done,0) done,jsonb_build_object('userId',e.user_id,'userType',e.user_type,'name',e.name,'role',e.role,
 'total',coalesce(t.total,0),'done',coalesce(t.done,0),'pending',coalesce(t.total-t.done,0),'completionRate',case when t.total>0 then round(100.0*t.done/t.total) else 0 end,
 'onTimeRate',case when t.rated>0 then round(100.0*t.ontime/t.rated) end,'points',coalesce(t.points,0),'loggedHours',round(coalesce(l.seconds,0)/3600.0,2),
 'trackedHours',round(coalesce(s.seconds,0)::numeric/3600,2),'avgProductivity',round(s.score::numeric,1)) row
 from people e left join person_tasks t on e.user_type='developer' and t.developer_id=e.user_id
 left join person_logs l on l.user_type=e.user_type and l.developer_id=e.user_id left join person_sessions s on e.user_type='developer' and s.person_id=e.user_id
 ), time_rows as materialized (
 select l.id::text key,l.started_at sort_date,round(coalesce(l.seconds,0)/3600.0,2) hours,jsonb_build_object('id',l.id,'date',(l.started_at at time zone 'UTC')::date,
 'developer',coalesce(e.name,case when l.user_type in ('admin','developer') then 'Unknown' else 'Unknown (identity unresolved)' end),
 'project',coalesce(p.name,'—'),'task',coalesce(t.task_title,'—'),'hours',round(coalesce(l.seconds,0)/3600.0,2),'source',coalesce(nullif(l.source,''),'web_timer')) row
 from logs l left join people e on e.user_type=l.user_type and e.user_id=l.developer_id left join projects_source p on p.id=l.project_id left join tasks t on t.id=l.task_id where l.ended_at is not null
 ), delay_rows as materialized (
 select t.id::text key,case when t.normalized='completed' then t.completed_on-t.due else (now() at time zone 'UTC')::date-t.due end late,
 jsonb_build_object('id',t.id,'task',coalesce(nullif(t.task_title,''),'Untitled'),'project',coalesce(p.name,'—'),'assignee',coalesce(e.name,'Unassigned'),'due',t.due,
 'state',case when t.normalized='completed' then 'Completed late' else 'Overdue' end,'daysLate',case when t.normalized='completed' then t.completed_on-t.due else (now() at time zone 'UTC')::date-t.due end) row
 from tasks t left join projects_source p on p.id=t.project_id left join people e on e.user_type='developer' and e.user_id=t.developer_id
 where (t.normalized='completed' and t.completed_on>t.due) or (t.normalized<>'completed' and t.due<(now() at time zone 'UTC')::date)
 ), days as (select p_from+i as day from generate_series(0,p_to-p_from) i),
 daily_tasks as (select completed_on as day,count(*) n from tasks where normalized='completed' group by completed_on),
 daily_logs as (select (started_at at time zone 'UTC')::date as day,sum(coalesce(seconds,0)) seconds from logs group by 1),
 daily_sessions as (select (start_time at time zone 'UTC')::date as day,sum(coalesce(total_duration,0)) seconds from sessions group by 1),
 trend as (select jsonb_build_object('days',jsonb_agg(d.day order by d.day),'completed',jsonb_agg(coalesce(t.n,0) order by d.day),'loggedHours',jsonb_agg(round(coalesce(l.seconds,0)/3600.0,2) order by d.day),'trackedHours',jsonb_agg(round(coalesce(s.seconds,0)::numeric/3600,2) order by d.day)) value from days d left join daily_tasks t using(day) left join daily_logs l using(day) left join daily_sessions s using(day)),
 all_rows as (
 select row,key,0::numeric ranking from project_rows where p_view='projects' union all select row,key,0 from team_rows where p_view='team'
 union all select row,key,extract(epoch from sort_date) from time_rows where p_view='time' union all select row,key,-late from delay_rows where p_view='delays'
 ), page as (select * from all_rows order by ranking,key limit p_limit offset p_offset)
 select jsonb_build_object('orgId',org,'range',jsonb_build_object('from',p_from,'to',p_to),'view',p_view) ||
 case when p_view='overview' then jsonb_build_object(
 'kpis',jsonb_build_object('projects',(select count(*) from projects_source),'tasks',t.total,'done',t.done,'completionRate',case when t.total>0 then round(100.0*t.done/t.total) else 0 end,
 'loggedHours',(select round(coalesce(sum(seconds),0)/3600.0,1) from logs),'trackedHours',(select round(coalesce(sum(total_duration),0)::numeric/3600,1) from sessions),'overdue',t.overdue),
 'statusCounts',jsonb_build_object('total',t.total,'rejected',t.rejected,'pending',t.pending,'in_progress',t.in_progress,'awaiting_approval',t.awaiting_approval,'completed',t.done),
 'trend',(select value from trend),'projectTop',coalesce((select jsonb_agg(row order by workload desc,key) from (select * from project_rows order by workload desc,key limit 10) x),'[]'::jsonb),
 'teamTop',coalesce((select jsonb_agg(row order by done desc,key) from (select * from team_rows order by done desc,key limit 12) x),'[]'::jsonb),
 'totals',jsonb_build_object('projects',(select count(*) from project_rows),'team',(select count(*) from team_rows),'time',(select count(*) from time_rows),'delays',(select count(*) from delay_rows),'timedHours',(select coalesce(sum(hours),0) from time_rows)))
 else jsonb_build_object('rows',coalesce((select jsonb_agg(row order by ranking,key) from page),'[]'::jsonb),'total',(select count(*) from all_rows),'offset',p_offset,
 'nextOffset',case when p_offset::bigint+(select count(*) from page)<(select count(*) from all_rows) then p_offset::bigint+(select count(*) from page) end) end into answer from task_totals t;
 return answer;
end $$;
revoke all on function public.report_data(date,date,text,integer,integer) from public,anon,service_role;
grant execute on function public.report_data(date,date,text,integer,integer) to authenticated;
commit;
