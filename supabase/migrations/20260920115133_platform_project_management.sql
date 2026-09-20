begin;
-- Narrow override for audited platform maintenance, including task cascades.
-- Only a service-role transaction carrying a freshly checked platform identity
-- can use it. Tenant tokens cannot elevate through custom settings.
create or replace function app_private.guard_delivery_write_lock()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare organizations_to_check uuid[]; target_org uuid;
begin
 if tg_op='INSERT' then organizations_to_check:=array[new.organization_id];
 elsif tg_op='DELETE' then organizations_to_check:=array[old.organization_id];
 else organizations_to_check:=array[old.organization_id,new.organization_id]; end if;
 for target_org in select distinct org from unnest(organizations_to_check) org where org is not null order by org loop
  if tg_op='DELETE' and not exists(select 1 from public.organizations where id=target_org) then continue; end if;
  if current_setting('role',true)='service_role'
    and current_setting('app.platform_project_org',true)=target_org::text then
   perform app_private.require_platform_permission(nullif(current_setting('app.platform_actor',true),'')::uuid,nullif(current_setting('app.platform_session',true),'')::uuid,'projects.manage');
   continue;
  end if;
  perform app_private.lock_quota(target_org);
  if not app_private.org_unlocked(target_org) then raise exception 'BILLING_LOCKED: subscription requires attention' using errcode='P0001'; end if;
 end loop;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function app_private.guard_delivery_write_lock() from public,anon,authenticated;

create function public.platform_project_action(p_auth uuid,p_session uuid,p_project uuid,p_action text,p_reason text,p_name text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare project public.projects%rowtype; result jsonb;
begin
 perform app_private.require_platform_permission(p_auth,p_session,'projects.manage');
 if p_action not in ('archive','restore','delete') or p_action is null or p_reason is null or length(trim(p_reason)) not between 8 and 500 then
  raise exception 'Choose an action and provide a reason of 8–500 characters' using errcode='22023'; end if;
 select * into project from public.projects where id=p_project for update;
 if not found then raise exception 'Project not found' using errcode='P0002'; end if;
 if exists(select 1 from app_private.organization_deletions where organization_id=project.organization_id and status<>'completed') then
  raise exception 'Organization cleanup is in progress' using errcode='55000'; end if;
 if p_action='delete' and p_name is distinct from project.name then raise exception 'Type the exact project name' using errcode='22023'; end if;
 perform set_config('app.platform_actor',p_auth::text,true);
 perform set_config('app.platform_session',p_session::text,true);
 perform set_config('app.platform_project_org',project.organization_id::text,true);
 if p_action='delete' then
  delete from public.projects where id=p_project;
 else
  update public.projects set archived=(p_action='archive') where id=p_project;
 end if;
 insert into app_private.platform_audit(actor_id,organization_id,action,reason)
 values(p_auth,project.organization_id,'project.'||p_action,trim(p_reason)||' [project '||p_project::text||']');
 perform set_config('app.platform_project_org','',true);
 return jsonb_build_object('id',p_project,'action',p_action,'name',project.name);
end $$;
revoke all on function public.platform_project_action(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.platform_project_action(uuid,uuid,uuid,text,text,text) to service_role;
commit;
