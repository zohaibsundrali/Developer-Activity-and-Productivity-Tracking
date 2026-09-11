begin;
-- Retain drafts with any linked records (proof, comments, time logs, files,
-- dependencies), not only submissions. FK metadata also covers future modules.
create or replace function app_private.task_has_linked_records(p_task uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare reference record; linked boolean;
begin
  for reference in
    select c.conrelid, source.attname from pg_constraint c
    cross join lateral unnest(c.conkey,c.confkey) as keys(source_number,target_number)
    join pg_attribute source on source.attrelid=c.conrelid and source.attnum=keys.source_number
    join pg_attribute target on target.attrelid=c.confrelid and target.attnum=keys.target_number
    where c.contype='f' and c.confrelid='public.developer_tasks'::regclass and target.attname='id'
  loop
    execute format('select exists(select 1 from %s where %I=$1)',reference.conrelid::regclass,reference.attname)
      into linked using p_task;
    if linked then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function app_private.task_has_linked_records(uuid) from public;
create or replace function public.save_and_submit_task_plan(p_org uuid,p_project uuid,p_developer uuid,p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare project_row public.projects%rowtype; item jsonb; member_id uuid; saved jsonb; existing_id uuid; item_order int:=0;
begin
  if jsonb_typeof(p_tasks) is distinct from 'array' or jsonb_array_length(p_tasks)=0 then
    raise exception 'INVALID_PLAN: tasks are required' using errcode='22023';
  end if;
  select id into member_id from public.memberships where organization_id=p_org and user_id=p_developer
    and user_type='developer' and status='active' and role<>'client';
  if member_id is null or exists(select 1 from public.user_permissions where membership_id=member_id
    and permission_key='task.update_own' and allowed=false) then
    raise exception 'PLAN_FORBIDDEN: active contributor permission required' using errcode='42501';
  end if;
  perform app_private.lock_quota(p_org);
  if not app_private.org_unlocked(p_org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
  select * into project_row from public.projects where id=p_project and organization_id=p_org for update;
  if not found then raise exception 'PLAN_NOT_FOUND: project not found' using errcode='P0002'; end if;
  if project_row.assigned_developer_id is distinct from p_developer then
    raise exception 'PLAN_FORBIDDEN: project assignment required' using errcode='42501';
  end if;
  if coalesce(project_row.task_plan_status,'draft') not in ('draft','rejected','pending','') then
    raise exception 'PLAN_CONFLICT: plan cannot be replaced' using errcode='P0001';
  end if;
  -- A retry after a committed request must not replace the submitted plan.
  if project_row.task_plan_status is distinct from 'pending' then
    for item in select value from jsonb_array_elements(p_tasks) loop
      if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'task_title') is distinct from 'string'
        or nullif(btrim(item->>'task_title'),'') is null
        or nullif(item->>'start_date','') is null or nullif(item->>'end_date','') is null
        or (item->>'end_date')::date < (item->>'start_date')::date then
        raise exception 'INVALID_PLAN: title and valid date range are required' using errcode='22023';
      end if;
    end loop;
    -- Lock rows before checking children so a concurrent submission cannot be
    -- committed between the existence check and the cascading delete.
    perform 1 from public.developer_tasks where project_id=p_project and developer_id=p_developer
      and organization_id=p_org for update;
    if exists(select 1 from jsonb_array_elements(p_tasks) where nullif(value->>'id','') is not null
      group by (value->>'id')::uuid having count(*)>1) then
      raise exception 'INVALID_PLAN: duplicate existing task ID' using errcode='22023';
    end if;
    for item in select value from jsonb_array_elements(p_tasks) loop
      existing_id:=nullif(item->>'id','')::uuid;
      if existing_id is not null and not exists(select 1 from public.developer_tasks
        where id=existing_id and project_id=p_project and developer_id=p_developer and organization_id=p_org) then
        raise exception 'PLAN_FORBIDDEN: existing task does not belong to this plan' using errcode='42501';
      end if;
    end loop;
    delete from public.developer_tasks t where t.project_id=p_project and t.developer_id=p_developer
      and t.organization_id=p_org and coalesce(t.status,'pending')='pending'
      and not app_private.task_has_linked_records(t.id)
      and not exists(select 1 from jsonb_array_elements(p_tasks) where nullif(value->>'id','')::uuid=t.id);
    for item in select value from jsonb_array_elements(p_tasks) loop
      existing_id:=nullif(item->>'id','')::uuid;
      if existing_id is null then
        insert into public.developer_tasks(organization_id,project_id,developer_id,task_title,task_description,
          task_order,start_date,end_date,status,created_at,updated_at)
        values(p_org,p_project,p_developer,btrim(item->>'task_title'),coalesce(item->>'task_description',''),
          item_order,(item->>'start_date')::date,(item->>'end_date')::date,'pending',now(),now());
      else
        -- Preserve started/linked work as-is; only untouched drafts are edited
        -- by a plan replacement. Existing IDs never become newly inserted rows.
        update public.developer_tasks set task_title=btrim(item->>'task_title'),
          task_description=coalesce(item->>'task_description',''),task_order=item_order,
          start_date=(item->>'start_date')::date,end_date=(item->>'end_date')::date,updated_at=now()
          where id=existing_id and coalesce(status,'pending')='pending'
          and not app_private.task_has_linked_records(existing_id);
      end if;
      item_order:=item_order+1;
    end loop;
    update public.projects set task_plan_submitted=true,task_plan_status='pending',task_plan_submitted_at=now(),
      task_plan_reviewed_at=null,task_plan_reviewed_by=null,task_plan_rejection_reason=null
      where id=p_project and organization_id=p_org returning * into project_row;
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.task_order,t.id),'[]'::jsonb) into saved
    from public.developer_tasks t where t.project_id=p_project and t.developer_id=p_developer and t.organization_id=p_org;
  return jsonb_build_object('success',true,'project',to_jsonb(project_row),'tasks',saved);
end;
$$;
revoke all on function public.save_and_submit_task_plan(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_and_submit_task_plan(uuid,uuid,uuid,jsonb) to service_role;
commit;
