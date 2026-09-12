begin;
create function app_private.recurring_next_date(p_anchor date,p_recurrence jsonb) returns date
language plpgsql immutable set search_path=pg_catalog as $$
declare step_text text; step_count integer; frequency text; result date;
begin
 if p_anchor is null or jsonb_typeof(p_recurrence) is distinct from 'object' then raise exception 'INVALID_RECURRENCE' using errcode='22023'; end if;
 frequency:=p_recurrence->>'freq';
 step_text:=case when p_recurrence ? 'interval' then p_recurrence->>'interval' else '1' end;
 if frequency is null or frequency not in ('daily','weekly','monthly') or step_text is null or
  (case when jsonb_typeof(p_recurrence->'interval')='number' then step_text!~'^[0-9]{1,4}(\.0+)?$' else step_text!~'^[0-9]{1,4}$' end) then
  raise exception 'INVALID_RECURRENCE: interval must be an integer between 1 and 3650' using errcode='22023';
 end if;
 step_count:=(step_text::numeric)::integer;
 if step_count<1 or step_count>3650 then raise exception 'INVALID_RECURRENCE: interval must be between 1 and 3650' using errcode='22023'; end if;
 if frequency='daily' then result:=p_anchor+step_count;
 elsif frequency='weekly' then result:=p_anchor+7*step_count;
 else
  -- Preserve Date.setMonth overflow, not PostgreSQL's end-of-month clamp.
  result:=(date_trunc('month',p_anchor::timestamp)+make_interval(months=>step_count)+(extract(day from p_anchor)::integer-1)*interval '1 day')::date;
 end if;
 return result;
end $$;
revoke all on function app_private.recurring_next_date(date,jsonb) from public,anon,authenticated;

create function public.spawn_recurring_task(p_template uuid,p_expected_recurrence jsonb,p_expected_anchor date,p_expected_next date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid; template public.developer_tasks; anchor date; next_day date; payload jsonb; columns_sql text; child uuid;
begin
 if p_template is null or p_expected_recurrence is null or p_expected_anchor is null or p_expected_next is null then
  raise exception 'RECURRENCE_SNAPSHOT_REQUIRED' using errcode='22023'; end if;
 select organization_id into org from public.developer_tasks where id=p_template;
 if org is null then return jsonb_build_object('spawned',false,'reason','template_missing'); end if;
 perform 1 from public.organizations where id=org for update;
 if not found or app_private.organization_deleting(org) then raise exception 'ORGANIZATION_UNAVAILABLE' using errcode='42501'; end if;
 perform app_private.lock_quota(org);
 select * into template from public.developer_tasks where id=p_template for update;
 if not found or template.organization_id is distinct from org or template.is_recurring is not true then
  return jsonb_build_object('spawned',false,'reason','template_changed'); end if;
 if template.recurrence is distinct from p_expected_recurrence then return jsonb_build_object('spawned',false,'reason','template_changed'); end if;
 if not app_private.org_unlocked(org) or not app_private.plan_feature(org,'automation') then
  raise exception 'AUTOMATION_PLAN_UNAVAILABLE' using errcode='42501'; end if;
 if nullif(template.recurrence->>'last_spawned','') is not null then
  if template.recurrence->>'last_spawned' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_RECURRENCE_CURSOR' using errcode='22023'; end if;
  anchor:=(template.recurrence->>'last_spawned')::date;
 else anchor:=coalesce(template.due_date,template.end_date); end if;
 if anchor is distinct from p_expected_anchor then return jsonb_build_object('spawned',false,'reason','template_changed'); end if;
 next_day:=app_private.recurring_next_date(anchor,template.recurrence);
 if next_day is distinct from p_expected_next then raise exception 'RECURRENCE_NEXT_DATE_MISMATCH' using errcode='22023'; end if;
 if next_day>(now() at time zone 'UTC')::date then return jsonb_build_object('spawned',false,'reason','not_due'); end if;
 if not exists(select 1 from public.projects p where p.id=template.project_id and p.organization_id=org) then
  raise exception 'RECURRING_PROJECT_UNAVAILABLE' using errcode='42501'; end if;
 if template.developer_id is not null and not exists(select 1 from public.memberships m
  join public.developers d on d.id=m.user_id and d.organization_id=m.organization_id
  where m.organization_id=org and m.user_id=template.developer_id and m.user_type='developer' and m.status='active'
   and m.role<>'client' and not coalesce((to_jsonb(m)->>'deletion_blocked')::boolean,false)) then
  raise exception 'RECURRING_ASSIGNEE_UNAVAILABLE' using errcode='42501'; end if;
 payload:=to_jsonb(template)||jsonb_build_object('status','pending','start_date',next_day,'end_date',next_day,'due_date',next_day,'is_recurring',false,'recurrence','{}'::jsonb);
 -- Copy only definition fields; completion, review and measured work start
 -- fresh. Database defaults and all existing quota/assignment triggers run.
 select string_agg(format('%I',a.attname),',' order by a.attnum) into columns_sql from pg_attribute a
 where a.attrelid='public.developer_tasks'::regclass and a.attnum>0 and not a.attisdropped and a.attgenerated='' and a.attname=any(array[
  'organization_id','project_id','developer_id','task_title','task_description','task_order','task_type','client_visible',
  'priority','story_points','estimated_hours','tags','labels','custom_fields','position','parent_task_id','sprint_id','epic_id',
  'severity','steps_to_reproduce','environment','reported_by','status','start_date','end_date','due_date','is_recurring','recurrence']);
 execute format('insert into public.developer_tasks(%s) select %s from jsonb_populate_record(null::public.developer_tasks,$1) returning id',columns_sql,columns_sql)
 into child using payload;
 update public.developer_tasks set recurrence=template.recurrence||jsonb_build_object('last_spawned',to_char(next_day,'YYYY-MM-DD')) where id=p_template;
 insert into public.pm_activity(organization_id,project_id,entity_type,entity_id,action,meta)
 values(org,template.project_id,'task',p_template,'recurring_spawned',jsonb_build_object('next',next_day,'spawnedTaskId',child));
 return jsonb_build_object('spawned',true,'taskId',child,'next',next_day);
end $$;
revoke all on function public.spawn_recurring_task(uuid,jsonb,date,date) from public,anon,authenticated;
grant execute on function public.spawn_recurring_task(uuid,jsonb,date,date) to service_role;
commit;
