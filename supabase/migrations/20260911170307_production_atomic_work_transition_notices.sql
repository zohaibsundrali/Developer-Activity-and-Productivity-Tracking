begin;
create function private.work_notice_project_reader(p_org uuid,p_user uuid,p_type text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.memberships m where m.organization_id=p_org and m.user_id=p_user and m.user_type=p_type
  and m.status='active' and m.user_type in ('admin','developer') and m.role<>'client'
  and (coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='project.view_own'),true)
   or coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='project.view_all'),m.role in ('owner','admin','manager','team_lead'),false)));
$$;
revoke all on function private.work_notice_project_reader(uuid,uuid,text) from public,anon,authenticated;
create function public.notify_project_assignment_transaction() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$ begin
 if tg_op='UPDATE' and new.assigned_developer_id is not distinct from old.assigned_developer_id then return new; end if;
 if new.assigned_developer_id is not null and private.work_notice_project_reader(new.organization_id,new.assigned_developer_id,'developer') then
  insert into public.notifications(organization_id,developer_id,type,category,title,message,project_id,entity_type,entity_id,read)
  values(new.organization_id,new.assigned_developer_id,'project_assigned','assignment','Project assigned',
   format('"%s" has been assigned to you.',new.name),new.id,'project',new.id,false);
 end if;
 return new;
end $$;
revoke all on function public.notify_project_assignment_transaction() from public,anon,authenticated;
create trigger project_assignment_notice after insert or update of assigned_developer_id on public.projects
 for each row execute function public.notify_project_assignment_transaction();
create function public.notify_task_status_transaction() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$ begin
 -- Terminal review outcomes have their own authoritative review notices.
 if new.status is not distinct from old.status or new.status in ('completed','rejected') then return new; end if;
 if new.developer_id is not null and private.assignment_notice_recipient(new.organization_id,new.developer_id,new.task_type) then
  insert into public.notifications(organization_id,developer_id,type,category,title,message,task_id,project_id,metadata,read)
  values(new.organization_id,new.developer_id,'task_status_changed','status','Task status changed',
   format('"%s" moved from %s to %s.',coalesce(new.task_title,'A task'),replace(coalesce(old.status,'pending'),'_',' '),replace(new.status,'_',' ')),
   new.id,new.project_id,jsonb_build_object('previousStatus',old.status,'status',new.status),false);
 end if;
 return new;
end $$;
revoke all on function public.notify_task_status_transaction() from public,anon,authenticated;
create trigger task_status_notice after update of status on public.developer_tasks
 for each row execute function public.notify_task_status_transaction();
create function public.notify_milestone_transaction() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare project_row public.projects%rowtype; recipient public.memberships%rowtype;
begin
 if new.status is distinct from 'completed' then return new; end if;
 if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
 select * into project_row from public.projects where id=new.project_id and organization_id=new.organization_id;
 if not found then raise exception 'Milestone project must belong to its organization' using errcode='23514'; end if;
 for recipient in select * from public.memberships m where m.organization_id=new.organization_id
  and private.work_notice_project_reader(new.organization_id,m.user_id,m.user_type)
  and ((m.user_type='developer' and m.user_id=coalesce(project_row.assigned_developer_id,project_row.assigned_to))
   or public.project_actor_is_owner(new.organization_id,new.project_id,m.user_id,m.user_type,false)
   or public.project_actor_is_manager(new.organization_id,new.project_id,m.user_id,m.user_type))
 loop
  insert into public.notifications(organization_id,admin_id,admin_recipient_type,developer_id,type,category,title,message,project_id,entity_type,entity_id,metadata,read)
  values(new.organization_id,case when recipient.user_type='admin' then recipient.user_id::text end,
   case when recipient.user_type='admin' then 'admin' end,case when recipient.user_type='developer' then recipient.user_id end,
   'milestone_completed','project','Milestone reached',format('Milestone "%s" on %s is complete.',new.title,project_row.name),
   new.project_id,'milestone',new.id,jsonb_build_object('milestoneId',new.id,'status','completed'),false);
 end loop;
 return new;
end $$;
revoke all on function public.notify_milestone_transaction() from public,anon,authenticated;
create trigger milestone_completion_notice after insert or update of status on public.milestones
 for each row execute function public.notify_milestone_transaction();
create function public.guard_work_transition_notice() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
 if current_user not in ('postgres','supabase_admin','service_role') and new.type in ('project_assigned','task_status_changed','milestone_completed') then
  raise exception 'Work transition notifications require the authoritative transaction' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_work_transition_notice() from public,anon,authenticated;
create trigger ab_work_transition_notice before insert on public.notifications for each row execute function public.guard_work_transition_notice();
commit;
