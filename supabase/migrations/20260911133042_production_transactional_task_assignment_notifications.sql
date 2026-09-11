begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Membership authority is evaluated for the actual old/new typed assignee,
-- never IDs supplied as notification metadata.
create or replace function private.assignment_notice_recipient(p_org uuid,p_user uuid,p_kind text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.memberships m where m.organization_id=p_org and m.user_id=p_user
  and m.user_type='developer' and m.status='active' and m.role<>'client' and (
  coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.view_own'),m.role in ('owner','admin','manager','hr','finance','team_lead','qa','developer','designer','devops','employee'),false)
  or coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.view_all'),m.role in ('owner','admin','manager','team_lead'),false)
  or coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.review'),m.role in ('owner','admin','manager','team_lead','qa'),false)
  or (p_kind='bug' and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='bug.triage'),m.role in ('owner','admin','manager','team_lead','qa'),false))));
$$;
revoke all on function private.assignment_notice_recipient(uuid,uuid,text) from public,anon,authenticated;
create or replace function public.notify_task_assignment_transaction()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare previous_id uuid; actor uuid; actor_profile text; previous_title text; event_type text;
begin
 if tg_op='UPDATE' then
  if new.developer_id is not distinct from old.developer_id then return new; end if;
  previous_id:=old.developer_id;
  previous_title:=coalesce(nullif(old.task_title,''),'A task');
 end if;
 actor:=public.auth_app_user_id(); actor_profile:=auth.jwt()->'app_metadata'->>'user_type';
 if not exists(select 1 from public.memberships m where m.organization_id=new.organization_id and m.user_id=actor
  and m.user_type=actor_profile and m.user_type in ('admin','developer') and m.status='active' and m.role<>'client') then
  actor:=null; actor_profile:=null;
 end if;
 if new.developer_id is not null and private.assignment_notice_recipient(new.organization_id,new.developer_id,new.task_type)
  and not coalesce(actor_profile='developer' and actor=new.developer_id,false) then
  event_type:=case when previous_id is null then 'task_assigned' else 'task_reassigned' end;
  insert into public.notifications(organization_id,developer_id,type,category,title,message,task_id,project_id,actor_id,actor_type,metadata,read)
  values(new.organization_id,new.developer_id,event_type,'assignment','Task assigned to you',
   format('You have been assigned "%s".',coalesce(nullif(new.task_title,''),'a task')),new.id,new.project_id,actor,actor_profile,
   jsonb_build_object('taskTitle',new.task_title),false);
 end if;
 if previous_id is not null and private.assignment_notice_recipient(old.organization_id,previous_id,old.task_type)
  and not coalesce(actor_profile='developer' and actor=previous_id,false) then
  -- The old assignee may lose parent access immediately. Keep only their OLD
  -- title snapshot; no current task/project link or successor identity leaks.
  event_type:=case when new.developer_id is null then 'task_unassigned' else 'task_reassigned_away' end;
  insert into public.notifications(organization_id,developer_id,type,category,title,message,actor_id,actor_type,metadata,read)
  values(old.organization_id,previous_id,event_type,'assignment','Task assignment removed',
   format('"%s" is no longer assigned to you.',previous_title),actor,actor_profile,jsonb_build_object('taskTitle',previous_title),false);
 end if;
 return new;
end $$;
revoke all on function public.notify_task_assignment_transaction() from public,anon,authenticated;
create trigger task_assignment_notification after insert or update of developer_id on public.developer_tasks
 for each row execute function public.notify_task_assignment_transaction();
-- Browser writes cannot fabricate authoritative assignment/removal events.
create or replace function public.guard_assignment_notice_insert() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
 if current_user not in ('postgres','supabase_admin','service_role')
  and new.type in ('task_assigned','task_reassigned','task_reassigned_away','task_unassigned') then
  raise exception 'Assignment notifications require the task assignment transaction' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_assignment_notice_insert() from public,anon,authenticated;
create trigger ab_assignment_notice_authority before insert on public.notifications
 for each row execute function public.guard_assignment_notice_insert();
commit;
