-- Preserve existing management reassignment permissions for every task status.
-- Review/submission snapshots continue to retain the original typed author.
begin;
create or replace function public.guard_typed_task_assignee() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare assignee uuid; kind text;
begin
 if tg_op='UPDATE' then
  if new.developer_id is not distinct from old.developer_id and new.assignee_admin_id is not distinct from old.assignee_admin_id
   and new.organization_id is not distinct from old.organization_id then return new; end if;
 end if;
 if new.developer_id is not null and new.assignee_admin_id is not null then
  raise exception 'A task can have only one assignee' using errcode='23514'; end if;
 assignee:=coalesce(new.developer_id,new.assignee_admin_id);
 kind:=case when new.assignee_admin_id is not null then 'admin' else 'developer' end;
 if assignee is not null and not exists(select 1 from public.memberships m
  where m.organization_id=new.organization_id and m.user_id=assignee and m.user_type=kind
    and m.status='active' and m.role<>'client') then
  raise exception 'Task assignee must be active staff in this organization' using errcode='42501'; end if;
 return new;
end $$;
commit;
