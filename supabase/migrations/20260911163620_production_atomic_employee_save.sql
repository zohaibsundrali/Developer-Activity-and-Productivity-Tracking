begin;
-- Invoker RPC deliberately retains every existing row, rank, billing, cycle
-- and changed-field guard. Identity is resolved from the scoped membership.
create function public.save_employee_record(p_org uuid,p_membership uuid,p_user uuid,p_type text,p_membership_patch jsonb default '{}',p_profile_patch jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare member public.memberships%rowtype; old_profile public.employee_profiles%rowtype;
 fields text; values_sql text; assignments text; k text; required_permission text; saved uuid;
begin
 if p_org is null or p_org is distinct from public.auth_org() or p_type not in ('admin','developer') then
  raise exception 'Employee organization or profile is not accessible' using errcode='42501'; end if;
 if jsonb_typeof(p_membership_patch) is distinct from 'object' or jsonb_typeof(p_profile_patch) is distinct from 'object' then
  raise exception 'Employee patches must be objects' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(p_membership_patch) keys(field) where keys.field not in ('team_id','department_id','reports_to','status'))
  or exists(select 1 from jsonb_object_keys(p_profile_patch) keys(field) where keys.field not in ('designation','phone','address','skills','employment_status','employment_type','joining_date','work_schedule','photo_url','bio','weekly_hours')) then
  raise exception 'Unsupported employee field; role changes require the role API' using errcode='22023'; end if;
 select * into member from public.memberships where id=p_membership and organization_id=p_org and user_id=p_user and user_type=p_type;
 if not found then raise exception 'Employee not found or update is not permitted' using errcode='42501'; end if;
 if p_membership_patch<>'{}'::jsonb then
  select string_agg(format('%I=r.%I',key,key),',') into assignments from jsonb_object_keys(p_membership_patch) key;
  execute format('update public.memberships m set %s,updated_at=now() from jsonb_populate_record(null::public.memberships,$1) r where m.id=$2 and m.organization_id=$3 returning m.id',assignments)
   into saved using p_membership_patch,p_membership,p_org;
  if saved is null then raise exception 'Employee membership update was not permitted' using errcode='42501'; end if;
 end if;
 if p_profile_patch<>'{}'::jsonb then
  select * into old_profile from public.employee_profiles where organization_id=p_org and user_id=p_user and user_type=p_type;
  if found and old_profile.membership_id is distinct from p_membership then
   raise exception 'Employee profile membership needs repair before saving' using errcode='22023'; end if;
  -- UPDATE trigger enforces changed fields; INSERT has no OLD record, so apply
  -- the same field permissions explicitly to the supplied initial values.
  if old_profile.id is null then
   for k in select jsonb_object_keys(p_profile_patch) loop
    required_permission:=case when k='employment_status' then 'employee.activate' when k='weekly_hours' then 'employment.set_hours' else 'employee.manage' end;
    if not public.auth_people_permission(required_permission) then raise exception 'permission denied: %',required_permission using errcode='42501'; end if;
   end loop;
  end if;
  select string_agg(format('%I',key),','),string_agg(format('r.%I',key),','),string_agg(format('%I=excluded.%I',key,key),',')
   into fields,values_sql,assignments from jsonb_object_keys(p_profile_patch) key;
  execute format('insert into public.employee_profiles(organization_id,membership_id,user_id,user_type,%s) select $2,$3,$4,$5,%s from jsonb_populate_record(null::public.employee_profiles,$1) r on conflict(organization_id,user_id,user_type) do update set %s,updated_at=now() returning id',fields,values_sql,assignments)
   into saved using p_profile_patch,p_org,p_membership,p_user,p_type;
  if saved is null then raise exception 'Employee profile update was not permitted' using errcode='42501'; end if;
 end if;
 return jsonb_build_object('success',true,'membershipId',p_membership,'userId',p_user,'userType',p_type);
end $$;
revoke all on function public.save_employee_record(uuid,uuid,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.save_employee_record(uuid,uuid,uuid,text,jsonb,jsonb) to authenticated;
-- Actual changes generate notices in the membership transaction, including
-- direct authorized writers. Ambiguous legacy team leader UUIDs are omitted.
create function public.notify_employee_transition() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare recipient public.memberships%rowtype; target_team public.teams%rowtype;
 event_type text; heading text; body text; actor uuid; actor_profile text; employee_name text;
begin
 if new.user_type not in ('admin','developer') then return new; end if;
 actor:=public.auth_app_user_id(); actor_profile:=auth.jwt()->'app_metadata'->>'user_type';
 if not exists(select 1 from public.memberships m where m.organization_id=new.organization_id and m.user_id=actor and m.user_type=actor_profile and m.status='active') then actor:=null; actor_profile:=null; end if;
 employee_name:=coalesce(nullif(new.email,''),'A team member');
 if new.status is distinct from old.status then
  for recipient in select * from public.memberships m where m.organization_id=new.organization_id and m.status='active'
   and m.user_type in ('admin','developer') and m.role in ('owner','admin')
   and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='member.view'),true)
  loop
   insert into public.notifications(organization_id,admin_id,admin_recipient_type,developer_id,type,category,title,message,entity_type,entity_id,actor_id,actor_type,metadata,read)
   values(new.organization_id,case when recipient.user_type='admin' then recipient.user_id::text end,
    case when recipient.user_type='admin' then 'admin' end,case when recipient.user_type='developer' then recipient.user_id end,
    'employee_status_changed','team','Team member updated',format('%s was set to %s.',employee_name,new.status),'employee',new.user_id,
    actor,actor_profile,jsonb_build_object('employeeType',new.user_type,'membershipId',new.id,'status',new.status),false);
  end loop;
 end if;
 if new.team_id is not null and new.team_id is distinct from old.team_id then
  select * into target_team from public.teams where id=new.team_id and organization_id=new.organization_id;
  if not found then raise exception 'Assigned team must belong to the employee organization' using errcode='23514'; end if;
  for recipient in select * from public.memberships m where m.organization_id=new.organization_id and m.status='active' and m.user_type in ('admin','developer') and m.role<>'client'
   and ((m.user_id=new.user_id and m.user_type=new.user_type)
    or (m.user_id in (target_team.manager_id,target_team.team_lead_id)
     and 1=(select count(*) from public.memberships x where x.organization_id=new.organization_id and x.user_id=m.user_id and x.user_type in ('admin','developer'))))
   and (coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='team_stats.view'),m.role in ('owner','admin','hr'))
    or coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='team.view'),m.role in ('owner','admin','manager','team_lead'))
    or (m.team_id=new.team_id and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='team.view_own'),true)))
  loop
   if recipient.user_id=new.user_id and recipient.user_type=new.user_type then
    event_type:='team_assigned'; heading:='Added to a team'; body:=format('You were added to %s.',target_team.name);
   else event_type:='team_member_added'; heading:='New team member'; body:=format('%s was added to %s.',employee_name,target_team.name); end if;
   insert into public.notifications(organization_id,admin_id,admin_recipient_type,developer_id,type,category,title,message,entity_type,entity_id,actor_id,actor_type,metadata,read)
   values(new.organization_id,case when recipient.user_type='admin' then recipient.user_id::text end,
    case when recipient.user_type='admin' then 'admin' end,case when recipient.user_type='developer' then recipient.user_id end,
    event_type,'team',heading,body,'team',new.team_id,actor,actor_profile,
    jsonb_build_object('employeeId',new.user_id,'employeeType',new.user_type,'previousTeamId',old.team_id,'teamId',new.team_id),false);
  end loop;
 end if;
 return new;
end $$;
revoke all on function public.notify_employee_transition() from public,anon,authenticated;
create trigger employee_transition_notice after update of status,team_id on public.memberships
 for each row execute function public.notify_employee_transition();
create function public.guard_employee_notice_insert() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
 if current_user not in ('postgres','supabase_admin','service_role') and new.type in ('employee_status_changed','team_assigned','team_member_added') then
  raise exception 'Employee notifications require the membership transaction' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_employee_notice_insert() from public,anon,authenticated;
create trigger ab_employee_notice_authority before insert on public.notifications for each row execute function public.guard_employee_notice_insert();
commit;
