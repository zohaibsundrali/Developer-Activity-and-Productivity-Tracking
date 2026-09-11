begin;
-- Actual row transitions are the deduplication boundary: retries are no-ops,
-- while a legitimately reopened sprint announces its next start again.
create function public.notify_sprint_status_transaction() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare recipient record; actor uuid; actor_profile text;
begin
 if new.status is not distinct from old.status or new.status not in ('active','completed') then return new; end if;
 actor:=public.auth_app_user_id(); actor_profile:=auth.jwt()->'app_metadata'->>'user_type';
 if not exists(select 1 from public.memberships m where m.organization_id=new.organization_id and m.user_id=actor
  and m.user_type=actor_profile and m.user_type in ('admin','developer') and m.status='active' and m.role<>'client') then
  actor:=null; actor_profile:=null;
 end if;
 -- Every recipient gets a task they actually carry, never another member's
 -- task or an inaccessible supervisor-only sprint-page link.
 for recipient in
  select distinct on (t.developer_id) t.developer_id,t.id,t.project_id
  from public.developer_tasks t where t.organization_id=new.organization_id and t.sprint_id=new.id
   and t.developer_id is not null
   and (new.project_id is null or t.project_id=new.project_id)
   and private.assignment_notice_recipient(new.organization_id,t.developer_id,t.task_type)
  order by t.developer_id,t.id
 loop
  insert into public.notifications(organization_id,developer_id,type,category,title,message,task_id,project_id,
   entity_type,entity_id,actor_id,actor_type,metadata,read)
  values(new.organization_id,recipient.developer_id,
   case when new.status='active' then 'sprint_started' else 'sprint_completed' end,'sprint',
   case when new.status='active' then 'Sprint started' else 'Sprint completed' end,
   case when new.status='active' then format('Sprint "%s" has started — your tasks in it are now in flight.',new.name)
    else format('Sprint "%s" has been completed.',new.name) end,
   recipient.id,recipient.project_id,'task',recipient.id,actor,actor_profile,
   jsonb_build_object('sprintId',new.id,'sprintStatus',new.status),false);
 end loop;
 return new;
end $$;
revoke all on function public.notify_sprint_status_transaction() from public,anon,authenticated;
create trigger sprint_status_notification after update of status on public.sprints
 for each row execute function public.notify_sprint_status_transaction();
-- Leave existing write RLS and billing checks in charge of sprint mutations.
-- This guard prevents browser callers from forging the transaction's events.
create function public.guard_sprint_notice_insert() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
 if current_user not in ('postgres','supabase_admin','service_role') and new.type in ('sprint_started','sprint_completed') then
  raise exception 'Sprint notifications require the sprint status transaction' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_sprint_notice_insert() from public,anon,authenticated;
create trigger ab_sprint_notice_authority before insert on public.notifications
 for each row execute function public.guard_sprint_notice_insert();
commit;
