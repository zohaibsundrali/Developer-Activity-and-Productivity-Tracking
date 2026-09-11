begin;
-- This role cannot sign in or bypass RLS. It inherits exactly the existing
-- authenticated policies/grants, but no API/login role may SET ROLE into it.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='automation_actor_executor') then
  create role automation_actor_executor nologin nosuperuser nobypassrls nocreatedb nocreaterole inherit;
 end if;
 if exists(select 1 from pg_roles where rolname='automation_actor_executor' and (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)) then
  raise exception 'Unsafe automation executor role attributes'; end if;
end $$;
-- Ownership bypasses RLS even without BYPASSRLS. Reject all preexisting
-- owned objects in this database (including tables/types/schemas) except the
-- one fixed helper, and reject unexpected members who could assume this role.
create function private.assert_automation_executor_safe() returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare executor oid:=(select oid from pg_roles where rolname='automation_actor_executor');
begin
 if exists(select 1 from pg_auth_members am join pg_roles r on r.oid=am.roleid
   where am.member=executor and r.rolname<>'authenticated') then
  raise exception 'Automation executor inherits unexpected authority'; end if;
 if exists(select 1 from pg_auth_members am join pg_roles r on r.oid=am.member
   where am.roleid=executor and r.rolname<>'postgres') then
  raise exception 'Unexpected role can assume automation executor'; end if;
 if exists(select 1 from pg_shdepend d where d.refclassid='pg_authid'::regclass and d.refobjid=executor and d.deptype='o'
   and d.dbid in (0,(select oid from pg_database where datname=current_database()))
   and not (d.classid='pg_proc'::regclass and d.objid=coalesce(to_regprocedure('private.run_automation_as_actor(uuid,uuid,text,jsonb)')::oid,0))) then
  raise exception 'Automation executor owns unexpected database objects'; end if;
end $$;
revoke all on function private.assert_automation_executor_safe() from public,anon,authenticated,service_role;
select private.assert_automation_executor_safe();
grant authenticated to automation_actor_executor;
grant automation_actor_executor to postgres;
revoke automation_actor_executor from authenticated,anon,service_role,authenticator;
grant usage,create on schema private to automation_actor_executor;

-- Fixed, private operations. The owning role is intentionally NOT postgres:
-- every task read/update and notification INSERT below runs existing RLS and
-- field guards, including explicit denies and current typed actor attribution.
create function private.run_automation_as_actor(p_job uuid,p_lease uuid,p_operation text,p_notice jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public set row_security=on as $$
declare job public.automation_jobs%rowtype; task public.developer_tasks%rowtype; action jsonb; rule public.automation_rules%rowtype;
begin
 select * into job from public.automation_jobs where id=p_job and lease=p_lease and status='processing' and lease_until>now();
 if not found or not public.auth_plan_feature('automation') then raise exception 'Automation actor or lease is no longer authorized' using errcode='42501'; end if;
 if p_operation='apply' then return public.apply_actor_automation_action(p_job,p_lease); end if;
 if p_operation not in ('read','notice') then raise exception 'Unknown automation operation' using errcode='22023'; end if;
 action:=job.actions->job.next_action;
 if action->>'type' not in ('notify','email') then raise exception 'Stored action is not a delivery' using errcode='22023'; end if;
 if action->>'type'='email' and not public.auth_automation_manage() then raise exception 'Email actions require automation.manage' using errcode='42501'; end if;
 select * into task from public.developer_tasks where id=job.task_id and organization_id=job.organization_id;
 if not found then raise exception 'Automation task is no longer accessible' using errcode='42501'; end if;
 select * into rule from public.automation_rules where id=job.rule_id and organization_id=job.organization_id and enabled;
 if not found or (rule.project_id is not null and rule.project_id is distinct from task.project_id) then raise exception 'Automation rule scope is no longer valid' using errcode='42501'; end if;
 if p_operation='notice' then
  begin
  insert into public.notifications(organization_id,developer_id,admin_id,admin_recipient_type,type,title,message,project_id,task_id,dedupe_key,read)
  values(job.organization_id,(p_notice->>'developer_id')::uuid,p_notice->>'admin_id',p_notice->>'admin_recipient_type','automation',
   p_notice->>'title',p_notice->>'message',task.project_id,task.id,'automation:'||job.id||':'||job.next_action,false);
  exception when unique_violation then null;
  end;
 end if;
 return to_jsonb(task);
end $$;
alter function private.run_automation_as_actor(uuid,uuid,text,jsonb) owner to automation_actor_executor;
revoke all on function private.run_automation_as_actor(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.run_automation_as_actor(uuid,uuid,text,jsonb) to postgres;
revoke create on schema private from automation_actor_executor;

create function public.run_unattended_automation_step(p_job uuid,p_lease uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare job public.automation_jobs%rowtype; member public.memberships%rowtype; profile_auth uuid; auth_record jsonb; claims_before text;
 result jsonb; action jsonb; target uuid; target_type text; recipient public.memberships%rowtype; notice jsonb; actor_role text;
begin
 select * into job from public.automation_jobs where id=p_job and lease=p_lease and status='processing' and lease_until>now() for update;
 if not found then raise exception 'Automation lease expired' using errcode='42501'; end if;
 if not app_private.plan_feature(job.organization_id,'automation') or app_private.organization_deleting(job.organization_id) then
  raise exception 'Automation organization is unavailable' using errcode='42501'; end if;
 select * into member from public.memberships where organization_id=job.organization_id and user_id=job.actor_id and user_type=job.actor_type
  and status='active' and user_type in ('admin','developer') and role<>'client' for share;
 if not found then raise exception 'Automation actor is inactive' using errcode='42501'; end if;
 if job.actor_type='admin' then
  select auth_user_id into profile_auth from public.admin_users where id=job.actor_id and organization_id=job.organization_id;
 else
  select auth_user_id into profile_auth from public.developers where id=job.actor_id and organization_id=job.organization_id;
 end if;
 select to_jsonb(u) into auth_record from auth.users u where u.id=profile_auth;
 if auth_record is null or auth_record->>'deleted_at' is not null
  or coalesce((auth_record->>'banned_until')::timestamptz>now(),false)
  or auth_record->'raw_app_meta_data'->>'organization_id' is distinct from job.organization_id::text
  or auth_record->'raw_app_meta_data'->>'app_user_id' is distinct from job.actor_id::text
  or auth_record->'raw_app_meta_data'->>'user_type' is distinct from job.actor_type then
  raise exception 'Automation actor Auth identity is unavailable' using errcode='42501'; end if;
 actor_role:=auth_record->'raw_app_meta_data'->>'role';
 if public.role_rank(actor_role) is null or public.role_rank(member.role) is null then raise exception 'Automation actor role is invalid' using errcode='42501'; end if;
 if public.role_rank(member.role)<public.role_rank(actor_role) then actor_role:=member.role; end if;
 claims_before:=current_setting('request.jwt.claims',true);
 begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',profile_auth,'role','authenticated','app_metadata',
    jsonb_build_object('organization_id',job.organization_id,'app_user_id',job.actor_id,'user_type',job.actor_type,'role',actor_role))::text,true);
  if p_operation='notice' then
   -- Identity/content come only from the stored job, never worker parameters.
   result:=private.run_automation_as_actor(p_job,p_lease,'read');
   action:=job.actions->job.next_action;
   target:=public.try_uuid(case when action->>'target'='user' then action->>'userId' else coalesce(result->>'developer_id',action->>'userId') end);
   target_type:=nullif(action->>'userType','');
   if action->>'type'='notify' then target_type:=coalesce(target_type,'developer'); end if;
   if (select count(*) from public.memberships where organization_id=job.organization_id and user_id=target and user_type in ('admin','developer')
     and (target_type is null or user_type=target_type))<>1 then raise exception 'Automation recipient is ambiguous or unavailable' using errcode='42501'; end if;
   select * into recipient from public.memberships where organization_id=job.organization_id and user_id=target and user_type in ('admin','developer')
     and (target_type is null or user_type=target_type) and status='active';
   if not found then raise exception 'Automation recipient is inactive' using errcode='42501'; end if;
   notice:=jsonb_build_object('title',coalesce(action->>'subject',action->>'title','Task update'),
    'message',coalesce(action->>'message',format('Task "%s" was updated.',coalesce(result->>'task_title','Untitled'))),
    'developer_id',case when recipient.user_type='developer' then recipient.user_id end,
    'admin_id',case when recipient.user_type='admin' then recipient.user_id end,
    'admin_recipient_type',case when recipient.user_type='admin' then 'admin' end);
   if length(notice->>'title')>500 or length(notice->>'message')>20000 then raise exception 'Invalid automation message' using errcode='22023'; end if;
  end if;
  result:=private.run_automation_as_actor(p_job,p_lease,p_operation,notice);
  perform set_config('request.jwt.claims',coalesce(claims_before,''),true);
  return result;
 exception when others then
  perform set_config('request.jwt.claims',coalesce(claims_before,''),true);
  raise;
 end;
end $$;
revoke all on function public.run_unattended_automation_step(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.run_unattended_automation_step(uuid,uuid,text) to service_role;

create function public.pending_automation_actors(p_limit integer default 25)
returns table(organization_id uuid,actor_id uuid,actor_type text,role text)
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 -- Actor removal is terminal for queued work, rather than letting an abandoned
 -- actor repeatedly occupy the scheduler. Do not erase uncertain email state.
 update public.automation_jobs j set status=case when j.external_started then 'delivery_unknown' else 'cancelled' end,
  last_error=case when j.external_started then 'Actor unavailable; verify the previous email delivery before resending.' else 'Automation actor is no longer an active staff member.' end,
  lease=null,lease_until=null,next_attempt_at=null,updated_at=now()
 where (j.status in ('pending','failed') or (j.status='processing' and j.lease_until<now()))
 and not exists(select 1 from public.memberships m where m.organization_id=j.organization_id and m.user_id=j.actor_id
  and m.user_type=j.actor_type and m.status='active' and m.role<>'client' and m.user_type in ('admin','developer'));
 return query select j.organization_id,j.actor_id,j.actor_type,m.role
 from public.automation_jobs j join public.memberships m on m.organization_id=j.organization_id and m.user_id=j.actor_id and m.user_type=j.actor_type
 where m.status='active' and m.user_type in ('admin','developer') and m.role<>'client'
 and app_private.plan_feature(j.organization_id,'automation') and not app_private.organization_deleting(j.organization_id)
 and (j.status='pending' or (j.status='failed' and j.attempts<3 and j.next_attempt_at<=now()) or (j.status='processing' and j.lease_until<now()))
 group by j.organization_id,j.actor_id,j.actor_type,m.role order by min(j.updated_at),j.organization_id,j.actor_type,j.actor_id
 limit greatest(1,least(coalesce(p_limit,25),100));
end $$;
revoke all on function public.pending_automation_actors(integer) from public,anon,authenticated;
grant execute on function public.pending_automation_actors(integer) to service_role;
commit;
