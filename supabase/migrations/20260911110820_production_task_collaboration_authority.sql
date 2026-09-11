begin;
-- Checklists and dependencies are shared collaboration on readable tasks.
-- Inherit parent SELECT RLS rather than duplicating role or override rules.
create or replace function public.auth_task_collaboration(p_org uuid,p_task uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog,public as $$
 select p_org=public.auth_org() and not public.auth_is_client()
  and auth.jwt()->'app_metadata'->>'user_type' in ('admin','developer')
  and exists(select 1 from public.developer_tasks t where t.id=p_task and t.organization_id=p_org);
$$;
revoke all on function public.auth_task_collaboration(uuid,uuid) from public;
grant execute on function public.auth_task_collaboration(uuid,uuid) to authenticated;
do $$ declare tbl text; parent_rule text; begin
 foreach tbl in array array['task_checklists','task_dependencies'] loop
  parent_rule:='public.auth_task_collaboration(organization_id,task_id)';
  if tbl='task_dependencies' then parent_rule:=parent_rule||' and public.auth_task_collaboration(organization_id,depends_on_task_id)'; end if;
  execute format('alter table public.%I enable row level security',tbl);
  execute format('drop policy if exists task_collaboration_read on public.%I',tbl);
  execute format('create policy task_collaboration_read on public.%I as restrictive for select to authenticated using(%s)',tbl,parent_rule);
  execute format('drop policy if exists task_collaboration_insert on public.%I',tbl);
  execute format('create policy task_collaboration_insert on public.%I as restrictive for insert to authenticated with check(%s and public.auth_org_unlocked())',tbl,parent_rule);
  execute format('drop policy if exists task_collaboration_update on public.%I',tbl);
  execute format('create policy task_collaboration_update on public.%I as restrictive for update to authenticated using(%s and public.auth_org_unlocked()) with check(%s and public.auth_org_unlocked())',tbl,parent_rule,parent_rule);
  execute format('drop policy if exists task_collaboration_delete on public.%I',tbl);
  execute format('create policy task_collaboration_delete on public.%I as restrictive for delete to authenticated using(%s and public.auth_org_unlocked())',tbl,parent_rule);
 end loop;
end $$;
create or replace function public.guard_task_collaboration_identity() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
 if tg_op='UPDATE' then
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
    or new.task_id is distinct from old.task_id or new.created_at is distinct from old.created_at then
   raise exception 'Task collaboration identity is immutable' using errcode='42501'; end if;
 end if;
 if tg_table_name='task_dependencies' then
  if new.task_id=new.depends_on_task_id then raise exception 'A task cannot depend on itself' using errcode='22023'; end if;
  if tg_op='UPDATE' and new.depends_on_task_id is distinct from old.depends_on_task_id then
   raise exception 'Dependency endpoints are immutable' using errcode='42501'; end if;
 else
  if (tg_op='INSERT' or new.text is distinct from old.text) and nullif(btrim(new.text),'') is null then
   raise exception 'Checklist text is required' using errcode='22023'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_task_collaboration_identity() from public;
drop trigger if exists task_collaboration_identity on public.task_checklists;
create trigger task_collaboration_identity before insert or update on public.task_checklists for each row execute function public.guard_task_collaboration_identity();
drop trigger if exists task_collaboration_identity on public.task_dependencies;
create trigger task_collaboration_identity before insert or update on public.task_dependencies for each row execute function public.guard_task_collaboration_identity();
commit;
