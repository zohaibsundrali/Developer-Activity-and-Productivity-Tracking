begin;
-- Invoker execution retains the caller's source visibility and every existing
-- project/task INSERT policy, quota, review and relationship trigger.
create or replace function public.clone_project(p_source uuid,p_name text,p_copy_tasks boolean default true)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare source_project public.projects%rowtype; cloned_project public.projects%rowtype; cloned_task public.developer_tasks%rowtype;
 source_tasks jsonb:='[]'; task_ids jsonb:='{}'; item record; payload jsonb; parent_id text; cloned_count int:=0;
 clone_id uuid:=gen_random_uuid(); org uuid:=public.auth_org(); today date:=(now() at time zone 'UTC')::date;
begin
 if org is null or not coalesce(public.auth_project_mutation('project.create'),false) then
   raise exception 'CLONE_FORBIDDEN: project creation permission required' using errcode='42501'; end if;
 if not public.auth_org_unlocked() then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 -- Capture source configuration and visible tasks in one statement snapshot.
 -- FOR SHARE would also require the source project UPDATE policy (project.hub),
 -- accidentally denying an otherwise valid create grant plus read access.
 select to_jsonb(p) project,case when coalesce(p_copy_tasks,true) then
   (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.developer_tasks t
     where t.project_id=p.id and t.organization_id=org) else '[]'::jsonb end tasks
   into item from public.projects p where p.id=p_source and p.organization_id=org;
 if not found then raise exception 'CLONE_NOT_FOUND: source project not found' using errcode='P0002'; end if;
 source_project:=jsonb_populate_record(null::public.projects,item.project);
 source_tasks:=item.tasks;
 if coalesce(p_copy_tasks,true) then
   for item in select value from jsonb_array_elements(source_tasks) loop
     task_ids:=task_ids||jsonb_build_object(item.value->>'id',gen_random_uuid());
   end loop;
 end if;
 payload:=to_jsonb(source_project)-array['id','created_at','updated_at','name','status','progress',
   'total_tasks_count','completed_tasks_count','total_productivity_score','task_plan_submitted','task_plan_status',
   'task_plan_submitted_at','task_plan_reviewed_at','task_plan_reviewed_by','task_plan_rejection_reason',
   'completed_at','completed_by','client_signed_off_at','client_rating','client_feedback','closed_at','closed_by','closure_note'];
 payload:=payload||jsonb_build_object('id',clone_id,'organization_id',org,'name',coalesce(nullif(btrim(p_name),''),source_project.name||' (copy)'),
   'status','pending','progress',0,'total_tasks_count',0,'completed_tasks_count',0,'total_productivity_score',0,
   'task_plan_submitted',false,'task_plan_status','draft','is_template',false,'archived',false,'created_at',now(),'updated_at',now());
 cloned_project:=jsonb_populate_record(null::public.projects,payload);
 insert into public.projects select cloned_project.* returning * into cloned_project;
 -- Parents first. A parent outside the caller's copied snapshot is detached;
 -- it must never remain an edge back into the original or an invisible project.
 for item in
   with recursive source as (select value,value->>'id' id,value->>'parent_task_id' parent from jsonb_array_elements(source_tasks)),
   tree as (
     select s.value,s.id,0 depth from source s where s.parent is null or not task_ids?s.parent
     union all
     select child.value,child.id,tree.depth+1 from source child join tree on child.parent=tree.id
   ) select value from tree order by depth,id
 loop
   payload:=item.value-array['id','created_at','updated_at','submitted_at','reviewed_at','reviewed_by',
     'actual_completion_date','admin_comments','rejection_reason','is_on_time','productivity_points'];
   parent_id:=item.value->>'parent_task_id';
   payload:=payload||jsonb_build_object('id',task_ids->>(item.value->>'id'),'organization_id',org,'project_id',clone_id,
     'parent_task_id',task_ids->>parent_id,'status','pending','client_visible',false,'productivity_points',0,
     'start_date',coalesce(item.value->>'start_date',today::text),'end_date',coalesce(item.value->>'end_date',today::text),
     'created_at',now(),'updated_at',now());
   -- This feature clones projects and tasks, not their sprint/epic containers.
   -- Organization-wide open containers remain usable; project-owned or closed
   -- containers are deliberately detached from the new project.
   if not exists(select 1 from public.sprints where id=(payload->>'sprint_id')::uuid and organization_id=org
      and project_id is null and status is distinct from 'completed') then payload:=payload||'{"sprint_id":null}'; end if;
   if not exists(select 1 from public.epics where id=(payload->>'epic_id')::uuid and organization_id=org
      and project_id is null) then payload:=payload||'{"epic_id":null}'; end if;
   cloned_task:=jsonb_populate_record(null::public.developer_tasks,payload);
   insert into public.developer_tasks select cloned_task.*;
   cloned_count:=cloned_count+1;
 end loop;
 if cloned_count<>jsonb_array_length(source_tasks) then raise exception 'CLONE_INVALID: source task hierarchy contains a cycle' using errcode='22023'; end if;
 return jsonb_build_object('project',to_jsonb(cloned_project),'tasks',cloned_count);
end $$;
revoke all on function public.clone_project(uuid,text,boolean) from public,anon;
grant execute on function public.clone_project(uuid,text,boolean) to authenticated;
commit;
