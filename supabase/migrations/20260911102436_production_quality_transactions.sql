begin;
create or replace function app_private.assert_quality_actor(p_org uuid,p_actor uuid,p_type text,p_key text) returns void
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare m public.memberships%rowtype; begin
 select * into m from public.memberships where organization_id=p_org and user_id=p_actor and user_type=p_type
   and status='active' and user_type in ('admin','developer') and role<>'client';
 if not found or p_key not in ('test_run.manage','bug.raise') then
   raise exception 'QA_FORBIDDEN: active staff permission required' using errcode='42501'; end if;
 if not coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key=p_key),
   m.role in ('owner','admin','manager','team_lead','qa'),false) then
   raise exception 'QA_FORBIDDEN: permission required' using errcode='42501'; end if;
 perform app_private.lock_quota(p_org);
 if not app_private.org_unlocked(p_org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
end $$;
revoke all on function app_private.assert_quality_actor(uuid,uuid,text,text) from public;

create or replace function public.create_quality_run(p_org uuid,p_actor uuid,p_type text,p_project uuid,p_name text,p_notes text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare case_ids uuid[]; run_row public.test_runs%rowtype; begin
 perform app_private.assert_quality_actor(p_org,p_actor,p_type,'test_run.manage');
 if nullif(btrim(p_name),'') is null then raise exception 'QA_INVALID: Give the run a name' using errcode='22023'; end if;
 perform 1 from public.projects where id=p_project and organization_id=p_org for share;
 if not found then raise exception 'QA_NOT_FOUND: Project not found' using errcode='P0002'; end if;
 -- Lock the exact snapshot; cases added after this statement belong to the
 -- next run. Never quietly omit cases at the former arbitrary limit.
 select array_agg(id order by id) into case_ids from
   (select id from public.test_cases where organization_id=p_org and project_id=p_project and status='active'
     order by id limit 501 for share) cases;
 if coalesce(cardinality(case_ids),0)=0 then raise exception 'QA_INVALID: That project has no active test cases yet' using errcode='22023'; end if;
 if cardinality(case_ids)>500 then raise exception 'QA_INVALID: A run supports at most 500 active test cases; split the project scope first' using errcode='22023'; end if;
 insert into public.test_runs(organization_id,project_id,name,notes,created_by)
   values(p_org,p_project,left(btrim(p_name),200),nullif(left(btrim(p_notes),4000),''),p_actor) returning * into run_row;
 insert into public.test_executions(organization_id,run_id,test_case_id)
   select p_org,run_row.id,unnest(case_ids);
 return jsonb_build_object('success',true,'run',to_jsonb(run_row),'cases',cardinality(case_ids));
end $$;

create or replace function public.raise_quality_bug(p_org uuid,p_actor uuid,p_type text,p_execution uuid,p_description text,p_severity text,p_environment text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare execution_row public.test_executions%rowtype; case_row public.test_cases%rowtype;
  run_row public.test_runs%rowtype; bug_row public.developer_tasks%rowtype; run_id uuid;
begin
 perform app_private.assert_quality_actor(p_org,p_actor,p_type,'bug.raise');
 select e.run_id into run_id from public.test_executions e where e.id=p_execution and e.organization_id=p_org;
 if not found then raise exception 'QA_NOT_FOUND: Not found' using errcode='P0002'; end if;
 -- Run first, then execution: closure and duplicate clicks cannot interleave
 -- between the preconditions and the new defect link.
 select * into run_row from public.test_runs where id=run_id and organization_id=p_org for update;
 if not found then raise exception 'QA_NOT_FOUND: Test run not found' using errcode='P0002'; end if;
 if run_row.status='closed' then raise exception 'QA_CONFLICT: That test run is closed. Reopen it before changing results.'; end if;
 select * into execution_row from public.test_executions where id=p_execution and organization_id=p_org for update;
 if not found or execution_row.run_id is distinct from run_row.id then raise exception 'QA_CONFLICT: Test execution changed; retry'; end if;
 if execution_row.result not in ('failed','blocked') then raise exception 'QA_CONFLICT: Only a failed or blocked test raises a defect'; end if;
 if execution_row.bug_task_id is not null then raise exception 'QA_CONFLICT: That result already has a defect linked'; end if;
 select * into case_row from public.test_cases where id=execution_row.test_case_id and organization_id=p_org for share;
 if not found or case_row.project_id is distinct from run_row.project_id then raise exception 'QA_INVALID: Test case does not belong to this run project' using errcode='22023'; end if;
 perform 1 from public.projects where id=case_row.project_id and organization_id=p_org for share;
 if not found then raise exception 'QA_NOT_FOUND: Project not found' using errcode='P0002'; end if;
 insert into public.developer_tasks(organization_id,project_id,task_title,task_description,task_type,status,priority,
   start_date,end_date,severity,steps_to_reproduce,environment,reported_by)
 values(p_org,case_row.project_id,left('Failed test: '||coalesce(case_row.title,'test case'),300),nullif(left(btrim(p_description),8000),''),
   'bug','pending','medium',(now() at time zone 'UTC')::date,(now() at time zone 'UTC')::date,
   case when p_severity in ('critical','major','minor','trivial') then p_severity else 'major' end,
   nullif(case_row.steps,''),nullif(left(btrim(p_environment),2000),''),p_actor) returning * into bug_row;
 update public.test_executions set bug_task_id=bug_row.id,updated_at=now() where id=execution_row.id;
 return jsonb_build_object('success',true,'bug',to_jsonb(bug_row));
end $$;
revoke all on function public.create_quality_run(uuid,uuid,text,uuid,text,text),public.raise_quality_bug(uuid,uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_quality_run(uuid,uuid,text,uuid,text,text),public.raise_quality_bug(uuid,uuid,text,uuid,text,text,text) to service_role;
commit;
