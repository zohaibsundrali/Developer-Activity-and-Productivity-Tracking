begin;
create table public.automation_jobs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid not null,actor_type text not null check(actor_type in ('admin','developer')),
 task_id uuid not null references public.developer_tasks(id) on delete cascade,
 rule_id uuid references public.automation_rules(id) on delete set null,
 event text not null,task_snapshot jsonb not null,previous_snapshot jsonb,actions jsonb not null,
 next_action integer not null default 0,status text not null default 'pending' check(status in ('pending','processing','completed','failed','delivery_unknown','cancelled')),
 attempts integer not null default 0,lease uuid,lease_until timestamptz,next_attempt_at timestamptz default now(),last_error text,
 external_started boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index automation_jobs_actor_pending on public.automation_jobs(organization_id,actor_type,actor_id,status,created_at);
alter table public.automation_jobs enable row level security;
revoke all on public.automation_jobs from public,anon,authenticated;
grant select on public.automation_jobs to authenticated;
grant all on public.automation_jobs to service_role;
create policy automation_jobs_own on public.automation_jobs for select to authenticated using(
 organization_id=public.auth_org() and actor_id=public.auth_app_user_id() and actor_type=auth.jwt()->'app_metadata'->>'user_type'
 and exists(select 1 from public.developer_tasks t where t.id=automation_jobs.task_id and t.organization_id=automation_jobs.organization_id)
 and exists(select 1 from public.memberships m where m.organization_id=automation_jobs.organization_id and m.user_id=automation_jobs.actor_id and m.user_type=automation_jobs.actor_type and m.status='active'));
-- Authoring rules is separate from executing their actions as the event actor.
create or replace function public.auth_automation_manage() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.auth_org() is not null and not public.auth_is_client()
 and auth.jwt()->'app_metadata'->>'user_type' in ('admin','developer')
 and coalesce(public.auth_override('automation.manage'),public.auth_role() in ('owner','admin'),false);
$$;
revoke all on function public.auth_automation_manage() from public,anon;
grant execute on function public.auth_automation_manage() to authenticated;
create policy automation_author_insert on public.automation_rules as restrictive for insert to authenticated with check(public.auth_automation_manage());
create policy automation_author_update on public.automation_rules as restrictive for update to authenticated using(public.auth_automation_manage()) with check(public.auth_automation_manage());
create policy automation_author_delete on public.automation_rules as restrictive for delete to authenticated using(public.auth_automation_manage());
create or replace function public.guard_automation_rule_content() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
 if tg_op='UPDATE' and (new.organization_id,new.project_id,new.id) is distinct from (old.organization_id,old.project_id,old.id) then raise exception 'Automation rule scope is immutable' using errcode='23514'; end if;
 if tg_op='INSERT' and new.project_id is not null and not exists(select 1 from public.projects p where p.id=new.project_id and p.organization_id=new.organization_id) then raise exception 'Automation project must belong to its organization' using errcode='23514'; end if;
 if tg_op='INSERT' or new.actions is distinct from old.actions then
  if jsonb_typeof(new.actions)<>'array' or jsonb_array_length(new.actions)>50 then raise exception 'Automation requires an action array of at most50 actions' using errcode='23514'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_automation_rule_content() from public,anon,authenticated;
create trigger automation_rule_content before insert or update on public.automation_rules for each row execute function public.guard_automation_rule_content();
create or replace function public.capture_actor_automation_jobs() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare actor uuid:=public.auth_app_user_id(); profile text:=auth.jwt()->'app_metadata'->>'user_type';
 events text[]:='{}'; event_name text; rule public.automation_rules%rowtype; previous jsonb; running uuid; running_action jsonb; action_field text; expected_value text;
begin
 if not exists(select 1 from public.memberships m where m.organization_id=new.organization_id and m.user_id=actor and m.user_type=profile and m.status='active' and m.user_type in ('admin','developer') and m.role<>'client') then return new; end if;
 if not app_private.plan_feature(new.organization_id,'automation') then return new; end if;
 running:=public.try_uuid(nullif(current_setting('app.automation_job',true),''));
 if running is not null and tg_op='UPDATE' then
  select j.actions->j.next_action into running_action from public.automation_jobs j where j.id=running and j.organization_id=new.organization_id and j.task_id=new.id
   and j.actor_id=actor and j.actor_type=profile and j.status='processing' and j.lease_until>now();
  action_field:=case running_action->>'type' when 'assign' then 'developer_id' when 'set_status' then 'status' when 'set_priority' then 'priority' when 'add_label' then 'labels' end;
  expected_value:=case running_action->>'type' when 'assign' then running_action->>'userId' when 'set_status' then running_action->>'status' when 'set_priority' then running_action->>'priority' when 'add_label' then nullif(btrim(running_action->>'label'),'') end;
  -- A caller-set GUC alone is not authority. Suppress only the precise stored
  -- action, with every other field unchanged (apart from updated_at).
  if action_field is not null and expected_value is not null
   and (to_jsonb(new)-array[action_field,'updated_at']) is not distinct from (to_jsonb(old)-array[action_field,'updated_at'])
   and ((action_field<>'labels' and to_jsonb(new)->>action_field=expected_value)
     or (action_field='labels' and new.labels is not distinct from case when expected_value=any(coalesce(old.labels,'{}')) then old.labels else array_append(coalesce(old.labels,'{}'),expected_value) end)) then return new; end if;
 end if;
 if tg_op='INSERT' then events:=array['task_created'];
 else
  previous:=to_jsonb(old);
  if new.status is distinct from old.status then events:=array_append(events,'status_changed'); end if;
  if new.developer_id is distinct from old.developer_id then events:=array_append(events,'assigned'); end if;
  if new.priority is distinct from old.priority then events:=array_append(events,'priority_changed'); end if;
 end if;
 foreach event_name in array events loop
  for rule in select * from public.automation_rules r where r.organization_id=new.organization_id and r.enabled
   and (r.project_id is null or r.project_id=new.project_id) and r.trigger->>'event'=event_name order by r.created_at,r.id loop
   if nullif(rule.trigger->>'taskType','') is not null and rule.trigger->>'taskType'<>coalesce(new.task_type,'feature') then continue; end if;
   if nullif(rule.trigger->>'priority','') is not null and rule.trigger->>'priority'<>coalesce(new.priority,'medium') then continue; end if;
   if event_name='status_changed' and ((nullif(rule.trigger->>'to','') is not null and rule.trigger->>'to' is distinct from new.status)
    or (nullif(rule.trigger->>'from','') is not null and rule.trigger->>'from' is distinct from old.status)) then continue; end if;
   if event_name='priority_changed' and nullif(rule.trigger->>'toPriority','') is not null and rule.trigger->>'toPriority'<>coalesce(new.priority,'medium') then continue; end if;
   if jsonb_typeof(rule.actions)<>'array' or jsonb_array_length(rule.actions)=0 then continue; end if;
   insert into public.automation_jobs(organization_id,actor_id,actor_type,task_id,rule_id,event,task_snapshot,previous_snapshot,actions)
   values(new.organization_id,actor,profile,new.id,rule.id,event_name,to_jsonb(new),previous,rule.actions);
  end loop;
 end loop;
 return new;
end $$;
revoke all on function public.capture_actor_automation_jobs() from public,anon,authenticated;
create trigger actor_automation_events after insert or update on public.developer_tasks for each row execute function public.capture_actor_automation_jobs();
create or replace function public.claim_actor_automation_job(p_org uuid,p_actor uuid,p_type text,p_retry boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare job public.automation_jobs%rowtype;
begin
 if not exists(select 1 from public.memberships m where m.organization_id=p_org and m.user_id=p_actor and m.user_type=p_type and m.status='active' and m.user_type in ('admin','developer') and m.role<>'client') or not app_private.plan_feature(p_org,'automation') then return null; end if;
 -- Never automatically resend an email whose provider outcome may be unknown.
 update public.automation_jobs set status='delivery_unknown',last_error='Email outcome is unknown; verify delivery before deliberately resending.',lease=null,lease_until=null,updated_at=now()
 where organization_id=p_org and actor_id=p_actor and actor_type=p_type and status='processing' and lease_until<now() and external_started;
 select * into job from public.automation_jobs j where j.organization_id=p_org and j.actor_id=p_actor and j.actor_type=p_type
 and (j.status='pending' or (j.status='failed' and (p_retry or (j.attempts<3 and j.next_attempt_at<=now())))
  or (j.status='processing' and j.lease_until<now() and not j.external_started))
 order by j.created_at,j.id for update skip locked limit 1;
 if not found then return null; end if;
 update public.automation_jobs set status='processing',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now()
 where id=job.id returning * into job;
 return to_jsonb(job);
end $$;
revoke all on function public.claim_actor_automation_job(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_actor_automation_job(uuid,uuid,text,boolean) to service_role;
-- Apply only the stored action, under caller RLS. A verified running-job context
-- suppresses re-triggering; it never supplies a privileged identity or bypass.
create or replace function public.apply_actor_automation_action(p_job uuid,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare job public.automation_jobs%rowtype; task public.developer_tasks%rowtype; action jsonb; desired text; allowed boolean; old_context text; rule_project uuid; rule_enabled boolean;
begin
 select * into job from public.automation_jobs where id=p_job and lease=p_lease and status='processing' and lease_until>now();
 if not found then raise exception 'Automation lease or actor access is no longer valid' using errcode='42501'; end if;
 if not public.auth_plan_feature('automation') then raise exception 'Automation plan feature is unavailable' using errcode='42501'; end if;
 select * into task from public.developer_tasks where id=job.task_id and organization_id=job.organization_id for update;
 if not found then raise exception 'Automation task is no longer accessible' using errcode='42501'; end if;
 select r.project_id,r.enabled into rule_project,rule_enabled from public.automation_rules r where r.id=job.rule_id and r.organization_id=job.organization_id;
 if not found or not coalesce(rule_enabled,false) then raise exception 'Automation rule is no longer enabled or accessible' using errcode='42501'; end if;
 if rule_project is not null and rule_project is distinct from task.project_id then raise exception 'Automation project scope changed since dispatch' using errcode='40001'; end if;
 action:=job.actions->job.next_action;
 old_context:=current_setting('app.automation_job',true);
 perform set_config('app.automation_job',job.id::text,true);
 case action->>'type'
 when 'assign' then
  desired:=action->>'userId';
  if public.try_uuid(desired) is null then raise exception 'Invalid automation assignee' using errcode='22023'; end if;
  if task.developer_id is distinct from public.try_uuid(desired) and task.developer_id::text is distinct from job.task_snapshot->>'developer_id' then raise exception 'Automation task changed since dispatch' using errcode='40001'; end if;
  update public.developer_tasks set developer_id=desired::uuid,updated_at=now() where id=task.id returning * into task;
 when 'set_priority' then
  desired:=action->>'priority';
  if desired not in ('low','medium','high','urgent') or desired is null then raise exception 'Invalid automation priority' using errcode='22023'; end if;
  if task.priority is distinct from desired and task.priority is distinct from job.task_snapshot->>'priority' then raise exception 'Automation task changed since dispatch' using errcode='40001'; end if;
  update public.developer_tasks set priority=desired,updated_at=now() where id=task.id returning * into task;
 when 'set_status' then
  desired:=action->>'status';
  allowed:=desired=task.status or case coalesce(task.status,'pending')
   when 'pending' then desired in ('in_progress','awaiting_approval') when 'in_progress' then desired in ('pending','awaiting_approval')
   when 'awaiting_approval' then desired in ('in_progress','reviewed') when 'reviewed' then desired in ('awaiting_approval','in_progress')
   when 'rejected' then desired='in_progress' else false end;
  if not coalesce(allowed,false) or desired in ('completed','rejected') then raise exception 'Automation status transition is not permitted' using errcode='22023'; end if;
  if task.status is distinct from desired and task.status is distinct from job.task_snapshot->>'status' then raise exception 'Automation task changed since dispatch' using errcode='40001'; end if;
  update public.developer_tasks set status=desired,updated_at=now() where id=task.id returning * into task;
 when 'add_label' then
  desired:=nullif(btrim(action->>'label'),'');
  if desired is null then raise exception 'Automation label is required' using errcode='22023'; end if;
  update public.developer_tasks set labels=case when desired=any(coalesce(labels,'{}')) then labels else array_append(coalesce(labels,'{}'),desired) end,updated_at=now() where id=task.id returning * into task;
 else raise exception 'Action requires the notification/email dispatcher' using errcode='22023';
 end case;
 if not found then raise exception 'Automation task was not changed; check current permissions' using errcode='42501'; end if;
 perform set_config('app.automation_job',coalesce(old_context,''),true);
 return to_jsonb(task);
end $$;
revoke all on function public.apply_actor_automation_action(uuid,uuid) from public,anon;
grant execute on function public.apply_actor_automation_action(uuid,uuid) to authenticated;
commit;
