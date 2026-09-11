begin;
-- Evaluate live task references under the inbox reader's own RLS. Historical
-- reassignment-away snapshots intentionally carry no live object references.
create or replace function public.notification_task_visible(p_task uuid,p_submission uuid,p_entity_type text,p_entity_id text)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare task_ref uuid:=p_task; proof_ref uuid:=p_submission; entity_ref uuid;
begin
 if p_entity_type in ('task','submission') and p_entity_id is not null then
  entity_ref:=public.try_uuid(p_entity_id);
  if entity_ref is null then return false; end if;
  if p_entity_type='task' then
   if task_ref is not null and task_ref<>entity_ref then return false; end if; task_ref:=entity_ref;
  else
   if proof_ref is not null and proof_ref<>entity_ref then return false; end if; proof_ref:=entity_ref;
  end if;
 end if;
 if task_ref is not null and not exists(select 1 from public.developer_tasks t where t.id=task_ref and t.organization_id=public.auth_org()) then return false; end if;
 if proof_ref is not null and not exists(select 1 from public.task_submissions s join public.developer_tasks t on t.id=s.task_id and t.organization_id=s.organization_id
   where s.id=proof_ref and s.organization_id=public.auth_org() and (task_ref is null or task_ref=s.task_id)) then return false; end if;
 return true;
end $$;
revoke all on function public.notification_task_visible(uuid,uuid,text,text) from public,anon;
grant execute on function public.notification_task_visible(uuid,uuid,text,text) to authenticated;
create policy notifications_task_current_access on public.notifications as restrictive for select to authenticated
using(public.notification_task_visible(task_id,submission_id,entity_type,entity_id::text));

-- Sender scope is checked before privileged recipient permission lookup. This
-- callable helper cannot be used to inspect inaccessible tasks or other orgs.
create or replace function public.notification_task_recipient_allowed(p_org uuid,p_task uuid,p_user uuid,p_type text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_org=public.auth_org() and p_type in ('admin','developer') and exists(
 select 1 from public.developer_tasks t join public.memberships m on m.organization_id=t.organization_id
 where t.id=p_task and t.organization_id=p_org and m.user_id=p_user and m.user_type=p_type and m.status='active' and m.role<>'client'
 and public.auth_task_access(t.organization_id,t.project_id,t.developer_id,t.task_type,t.client_visible,'read')
 and (
  coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.view_all'),m.role in ('owner','admin','manager','team_lead'),false)
  or coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.review'),m.role in ('owner','admin','manager','team_lead','qa'),false)
  or (p_type='developer' and t.developer_id=p_user and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.view_own'),
    m.role in ('owner','admin','manager','hr','finance','team_lead','qa','developer','designer','devops','employee'),false))
  or (t.task_type='bug' and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='bug.triage'),m.role in ('owner','admin','manager','team_lead','qa'),false))
  ));
$$;
revoke all on function public.notification_task_recipient_allowed(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.notification_task_recipient_allowed(uuid,uuid,uuid,text) to authenticated;

create or replace function public.guard_task_notification_recipients()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare task_ref uuid:=new.task_id; key text;
begin
 if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
 if task_ref is null and new.entity_type='task' then task_ref:=public.try_uuid(new.entity_id::text); end if;
 if task_ref is null and new.submission_id is not null then
  select s.task_id into task_ref from public.task_submissions s where s.id=new.submission_id and s.organization_id=new.organization_id;
 end if;
 if task_ref is null then return new; end if;
 foreach key in array coalesce(new.recipient_keys,array[]::text[]) loop
  if not coalesce(public.notification_task_recipient_allowed(new.organization_id,task_ref,split_part(key,':',2)::uuid,split_part(key,':',1)),false) then
   raise exception 'Notification recipient cannot access this task' using errcode='42501'; end if;
 end loop;
 return new;
end $$;
revoke all on function public.guard_task_notification_recipients() from public,anon,authenticated;
-- Canonical typed recipients and preference filtering run first.
create trigger zzzz_task_notification_recipients before insert on public.notifications
 for each row execute function public.guard_task_notification_recipients();
commit;
