begin;
-- Read-time enforcement applies to historical deliveries and the invoker inbox.
-- The lookup uses current typed membership and complete historical aliases;
-- suspended collisions cannot turn an ambiguous reporting address into access.
create or replace function public.notification_sensitive_visible(p_type text,p_category text,p_metadata jsonb)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare member public.memberships%rowtype; subject_member public.memberships%rowtype; manager public.memberships%rowtype;
 org uuid:=public.auth_org(); actor uuid:=public.auth_app_user_id(); profile text:=auth.jwt()->'app_metadata'->>'user_type';
 is_signal boolean:=coalesce(p_type='signal' or p_category='signal',false); is_billing boolean; subject_alias text; manager_alias text; identities int;
begin
 is_billing:=coalesce(p_category='billing' or p_type='trial_reminder' or p_type like 'billing.%' or p_type like 'billing\_%' escape '\',false)
   or (is_signal and (p_metadata->>'kind'='plan_pressure' or p_metadata->'subject'->>'type'='plan'));
 if not is_signal and not coalesce(is_billing,false) then return true; end if;
 select * into member from public.memberships where organization_id=org and user_id=actor and user_type=profile and status='active' and user_type in ('admin','developer') and role<>'client';
 if not found then return false; end if;
 if is_billing and not coalesce((select allowed from public.user_permissions where membership_id=member.id and permission_key='billing.view'),member.role in ('owner','admin','finance'),false) then return false; end if;
 if not is_signal then return true; end if;
 if not coalesce((select allowed from public.user_permissions where membership_id=member.id and permission_key='signal.view'),member.role in ('owner','admin','hr','manager','team_lead'),false) then return false; end if;
 if p_metadata->'subject'->>'type' is distinct from 'person' then return true; end if;
 if member.role in ('owner','admin','hr') then return true; end if;
 subject_alias:=lower(btrim(p_metadata->'subject'->>'id'));
 if nullif(subject_alias,'') is null then return false; end if;
 select count(distinct m.user_type||':'||m.user_id::text) into identities from public.memberships m where m.organization_id=org and m.user_type in ('admin','developer')
  and (lower(m.user_id::text)=subject_alias or lower(btrim(m.email))=subject_alias);
 if identities<>1 then return false; end if;
 select * into subject_member from public.memberships m where m.organization_id=org and m.user_type='developer' and m.status='active'
  and (lower(m.user_id::text)=subject_alias or lower(btrim(m.email))=subject_alias);
 if not found then return false; end if;
 manager_alias:=lower(btrim(subject_member.reports_to::text));
 if nullif(manager_alias,'') is null then return false; end if;
 select count(distinct m.user_type||':'||m.user_id::text) into identities from public.memberships m where m.organization_id=org and m.user_type in ('admin','developer')
  and (lower(m.user_id::text)=manager_alias or lower(btrim(m.email))=manager_alias);
 if identities<>1 then return false; end if;
 return lower(member.user_id::text)=manager_alias or lower(btrim(member.email))=manager_alias;
end $$;
revoke all on function public.notification_sensitive_visible(text,text,jsonb) from public,anon;
grant execute on function public.notification_sensitive_visible(text,text,jsonb) to authenticated;
create policy notifications_sensitive_current_access on public.notifications as restrictive for select to authenticated
using(public.notification_sensitive_visible(type,category,metadata));
commit;
