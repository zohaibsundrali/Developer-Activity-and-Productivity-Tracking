begin;
-- SECURITY INVOKER intentionally inherits parent task RLS. Tightening task
-- permissions must also tighten comment access without a second permission map.
create or replace function public.auth_comment_parent(p_org uuid,p_task uuid,p_internal boolean)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
  select p_org=public.auth_org()
    and exists(select 1 from public.memberships m where m.organization_id=p_org
      and m.user_id=public.auth_app_user_id() and m.user_type=auth.jwt()->'app_metadata'->>'user_type' and m.status='active')
    and exists(select 1 from public.developer_tasks t where t.id=p_task and t.organization_id=p_org
      and (not public.auth_is_client() or (not p_internal and t.client_visible=true
        and t.project_id in(select public.auth_client_project_ids()) and public.auth_plan_feature('client_portal'))));
$$;
revoke all on function public.auth_comment_parent(uuid,uuid,boolean) from public;
grant execute on function public.auth_comment_parent(uuid,uuid,boolean) to authenticated;

alter table public.task_comments enable row level security;
create policy comment_parent_read on public.task_comments as restrictive for select to authenticated
using(public.auth_comment_parent(organization_id,task_id,internal));
create policy comment_author_insert on public.task_comments as restrictive for insert to authenticated
with check(public.auth_comment_parent(organization_id,task_id,internal)
  and author_id=public.auth_app_user_id() and author_type=auth.jwt()->'app_metadata'->>'user_type');
-- Clients can append to a public thread; they cannot rewrite its history.
-- Keep existing staff moderation (owner/admin/manager), including other authors.
create policy comment_author_update on public.task_comments as restrictive for update to authenticated
using(not public.auth_is_client() and public.auth_comment_parent(organization_id,task_id,internal)
  and ((author_id=public.auth_app_user_id() and author_type=auth.jwt()->'app_metadata'->>'user_type')
    or public.auth_role() in ('owner','admin','manager')))
with check(not public.auth_is_client() and public.auth_comment_parent(organization_id,task_id,internal));
create policy comment_author_delete on public.task_comments as restrictive for delete to authenticated
using(not public.auth_is_client() and public.auth_comment_parent(organization_id,task_id,internal)
  and ((author_id=public.auth_app_user_id() and author_type=auth.jwt()->'app_metadata'->>'user_type')
    or public.auth_role() in ('owner','admin','manager')));

create or replace function public.guard_comment_identity()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare profile_name text; profile_type text;
begin
  if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
  if tg_op='INSERT' then
    profile_type:=auth.jwt()->'app_metadata'->>'user_type';
    if new.author_id is distinct from public.auth_app_user_id() or new.author_type is distinct from profile_type
      or new.organization_id is distinct from public.auth_org() then
      raise exception 'Comment author must match verified identity' using errcode='42501';
    end if;
    case profile_type
      when 'admin' then select name into profile_name from public.admin_users where id=new.author_id and organization_id=new.organization_id;
      when 'developer' then select name into profile_name from public.developers where id=new.author_id and organization_id=new.organization_id;
      when 'client' then select name into profile_name from public.clients where id=new.author_id and organization_id=new.organization_id;
      else raise exception 'Comment author profile is invalid' using errcode='42501';
    end case;
    if not found then raise exception 'Comment author profile is unavailable' using errcode='42501'; end if;
    new.author_name:=coalesce(nullif(btrim(profile_name),''),case when profile_type='client' then 'Client' else 'Team Member' end);
  end if;
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
    or new.task_id is distinct from old.task_id or new.author_id is distinct from old.author_id
    or new.author_type is distinct from old.author_type or new.author_name is distinct from old.author_name
    or new.created_at is distinct from old.created_at) then
    raise exception 'Comment identity and attribution cannot be changed' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function public.guard_comment_identity() from public;
create trigger comment_identity before insert or update on public.task_comments
for each row execute function public.guard_comment_identity();
commit;
