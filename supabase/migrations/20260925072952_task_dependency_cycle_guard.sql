begin;
-- Normalize blocks and blocked_by into directed edges. relates_to is not a
-- blocking dependency and may be reciprocal. Existing rows remain unchanged.
-- Owner visibility is required to detect paths through tasks hidden by RLS;
-- this private trigger returns no graph data and cannot be invoked as an RPC.
create or replace function app_private.guard_task_dependency_cycle() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare edge_from uuid; edge_to uuid; cyclic boolean;
begin
  if new.type is null or new.type not in ('blocks','blocked_by') then return new; end if;
  if tg_op='UPDATE' and new.type is not distinct from old.type
    and new.task_id is not distinct from old.task_id
    and new.depends_on_task_id is not distinct from old.depends_on_task_id
    and new.organization_id is not distinct from old.organization_id then return new; end if;
  if current_setting('role',true)='authenticated' and new.organization_id is distinct from public.auth_org() then
    raise exception 'Task organization is not authorized' using errcode='42501';
  end if;
  edge_from:=case when new.type='blocks' then new.task_id else new.depends_on_task_id end;
  edge_to:=case when new.type='blocks' then new.depends_on_task_id else new.task_id end;
  if edge_from=edge_to then
    raise exception 'A task cannot block itself' using errcode='23514';
  end if;
  -- Physical write lock serializes competing graph edits and rejects stale
  -- REPEATABLE READ snapshots. Reuse the existing organization lock order.
  perform app_private.lock_quota(new.organization_id);
  with recursive edges(source,target) as (
    select case when d.type='blocks' then d.task_id else d.depends_on_task_id end,
           case when d.type='blocks' then d.depends_on_task_id else d.task_id end
    from public.task_dependencies d
    where d.organization_id=new.organization_id and d.type in ('blocks','blocked_by')
      and d.id is distinct from new.id
  ), reachable(id) as (
    select edge_to
    union
    select e.target from reachable r join edges e on e.source=r.id
  ) select exists(select 1 from reachable where id=edge_from) into cyclic;
  if cyclic then
    raise exception 'Blocking task dependencies cannot contain cycles' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function app_private.guard_task_dependency_cycle() from public,anon,authenticated;
create trigger task_dependency_cycle before insert or update on public.task_dependencies
for each row execute function app_private.guard_task_dependency_cycle();
commit;
