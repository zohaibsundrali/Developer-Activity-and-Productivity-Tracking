begin;
-- Type is part of identity. Drop the legacy three-column constraint by its
-- actual columns, since deployed constraint names are not guaranteed.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.task_watchers'::regclass and contype='u'
  and (select array_agg(a.attname::text order by a.attname) from unnest(conkey) k join pg_attribute a
    on a.attrelid=conrelid and a.attnum=k)=array['role','task_id','user_id'] loop
  execute format('alter table public.task_watchers drop constraint %I',c.conname);
 end loop;
end $$;
create unique index task_watchers_typed_identity on public.task_watchers(task_id,user_type,user_id,role);

create or replace function public.task_watcher_reviewer_eligible(p_org uuid,p_task uuid,p_user uuid,p_type text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_type in ('admin','developer') and exists(
  select 1 from public.memberships m join public.developer_tasks t on t.id=p_task and t.organization_id=m.organization_id
   join public.projects p on p.id=t.project_id and p.organization_id=m.organization_id
  where m.organization_id=p_org and m.user_id=p_user and m.user_type=p_type and m.status='active'
   and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.review'),
     m.role in ('owner','admin','manager','team_lead','qa'),false)
   and (p.created_by::text=p_user::text or p.added_by::text=p_user::text)
   and t.developer_id is distinct from p_user
   and not exists(select 1 from public.task_submissions s where s.organization_id=p_org and s.task_id=p_task
     and s.review_status='pending' and s.developer_id=p_user)
   -- Project creator columns are untyped; two different profiles sharing the
   -- UUID cannot safely be assigned ownership by a watcher selector.
   and not exists(select 1 from public.memberships other where other.organization_id=p_org and other.user_id=p_user
     and other.user_type in ('admin','developer') and other.user_type<>p_type));
$$;
revoke all on function public.task_watcher_reviewer_eligible(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.task_watcher_reviewer_eligible(uuid,uuid,uuid,text) to service_role;

create or replace function public.auth_watcher_write(p_org uuid,p_task uuid,p_user uuid,p_type text,p_role text,p_delete boolean)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare own_identity boolean;
begin
 if p_org is distinct from public.auth_org() or public.auth_is_client()
   or not coalesce(public.auth_org_unlocked(),false) then return false; end if;
 own_identity:=p_user=public.auth_app_user_id() and p_type=auth.jwt()->'app_metadata'->>'user_type';
 if p_delete then return coalesce(own_identity,false) or public.auth_task_capability('task.manage')
   or (p_role='reviewer' and public.auth_task_capability('task.review')); end if;
 if p_role='watcher' then return coalesce(own_identity,false); end if;
 if p_role='reviewer' then return (public.auth_task_capability('task.manage') or public.auth_task_capability('task.review'))
   and public.task_watcher_reviewer_eligible(p_org,p_task,p_user,p_type); end if;
 return false;
end $$;
revoke all on function public.auth_watcher_write(uuid,uuid,uuid,text,text,boolean) from public;
grant execute on function public.auth_watcher_write(uuid,uuid,uuid,text,text,boolean) to authenticated;
alter table public.task_watchers enable row level security;
create policy watcher_parent_access on public.task_watchers as restrictive for all to authenticated
using(public.auth_attachment_parent(organization_id,task_id)) with check(public.auth_attachment_parent(organization_id,task_id));
create policy watcher_insert_authority on public.task_watchers as restrictive for insert to authenticated
with check(public.auth_watcher_write(organization_id,task_id,user_id,user_type,role,false));
create policy watcher_update_authority on public.task_watchers as restrictive for update to authenticated
using(public.auth_watcher_write(organization_id,task_id,user_id,user_type,role,false))
with check(public.auth_watcher_write(organization_id,task_id,user_id,user_type,role,false));
create policy watcher_delete_authority on public.task_watchers as restrictive for delete to authenticated
using(public.auth_watcher_write(organization_id,task_id,user_id,user_type,role,true));
-- Upsert retries are idempotent; no browser flow changes an existing watcher's
-- identity, role, creation time, or task in place.
create or replace function public.guard_watcher_identity()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
 if to_jsonb(new) is distinct from to_jsonb(old) then
  raise exception 'Watcher identity cannot be changed; remove and add the subscription' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_watcher_identity() from public;
create trigger watcher_identity before update on public.task_watchers for each row execute function public.guard_watcher_identity();
commit;
