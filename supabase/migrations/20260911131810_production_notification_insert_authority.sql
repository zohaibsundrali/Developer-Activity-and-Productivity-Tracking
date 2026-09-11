begin;
alter table public.notifications add column actor_type text check(actor_type in ('admin','developer'));
-- Invoker is deliberate: reference existence is checked through the sender's
-- actual RLS, not a definer read which could authorize inaccessible work.
create or replace function public.guard_notification_insert_authority()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare actor uuid; profile text;
 task_project uuid; proof_task uuid; proof_project uuid; reference_id uuid;
begin
 if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
 actor:=public.auth_app_user_id();
 profile:=auth.jwt()->'app_metadata'->>'user_type';
 if new.organization_id is null or new.organization_id is distinct from public.auth_org()
  or profile not in ('admin','developer') or not exists(select 1 from public.memberships m
   where m.organization_id=new.organization_id and m.user_id=actor and m.user_type=profile and m.status='active' and m.role<>'client') then
  raise exception 'Notification sender must be active staff in this organization' using errcode='42501';
 end if;
 new.actor_id:=actor;
 new.actor_type:=profile;
 -- These notices are emitted by reviewed transactions/server cron only.
 -- Generic browser info/warning/team/comment/assignment notices remain valid.
 if new.type in ('task_approved','task_rejected','task_plan_approved','task_plan_rejected','review_required','task_submitted','trial_reminder','due_reminder','signal')
  or new.type like 'billing.%' or new.type like 'billing\_%' escape '\' then
  raise exception 'Notification event requires the authoritative server workflow' using errcode='42501';
 end if;
 -- Normalize typed entity aliases before checking the combined references.
 if new.entity_id is not null and new.entity_type in ('task','project','submission') then
  reference_id:=public.try_uuid(new.entity_id::text);
  if reference_id is null then raise exception 'Invalid notification entity reference' using errcode='23514'; end if;
  if new.entity_type='task' then
   if new.task_id is not null and new.task_id<>reference_id then raise exception 'Notification entity task does not match' using errcode='23514'; end if;
   new.task_id:=reference_id;
  elsif new.entity_type='project' then
   if new.project_id is not null and new.project_id<>reference_id then raise exception 'Notification entity project does not match' using errcode='23514'; end if;
   new.project_id:=reference_id;
  else
   if new.submission_id is not null and new.submission_id<>reference_id then raise exception 'Notification entity submission does not match' using errcode='23514'; end if;
   new.submission_id:=reference_id;
  end if;
 end if;
 if new.project_id is not null and not exists(select 1 from public.projects p where p.id=new.project_id and p.organization_id=new.organization_id) then
  raise exception 'Notification project is not accessible in this organization' using errcode='42501';
 end if;
 if new.task_id is not null then
  select t.project_id into task_project from public.developer_tasks t where t.id=new.task_id and t.organization_id=new.organization_id;
  if not found then raise exception 'Notification task is not accessible in this organization' using errcode='42501'; end if;
  if new.project_id is not null and new.project_id is distinct from task_project then
   raise exception 'Notification task and project do not match' using errcode='23514'; end if;
 end if;
 if new.submission_id is not null then
  select s.task_id,s.project_id into proof_task,proof_project from public.task_submissions s where s.id=new.submission_id and s.organization_id=new.organization_id;
  if not found then raise exception 'Notification submission is not accessible in this organization' using errcode='42501'; end if;
  if (new.task_id is not null and new.task_id is distinct from proof_task) or (new.project_id is not null and new.project_id is distinct from proof_project) then
   raise exception 'Notification submission references do not match' using errcode='23514'; end if;
  select t.project_id into task_project from public.developer_tasks t where t.id=proof_task and t.organization_id=new.organization_id;
  if not found then raise exception 'Notification submission task is not accessible' using errcode='42501'; end if;
  if task_project is distinct from proof_project then raise exception 'Notification submission task and project do not match' using errcode='23514'; end if;
 end if;

 return new;
end $$;
revoke all on function public.guard_notification_insert_authority() from public,anon,authenticated;
create trigger aa_notification_insert_authority before insert on public.notifications
 for each row execute function public.guard_notification_insert_authority();
commit;
