-- Standalone fixture: run in an EMPTY database, then apply the production
-- migration at the marked include below. No application or storage data used.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create table public.developer_tasks(id int primary key);
create table public.task_submissions(id int primary key,task_id int references public.developer_tasks on delete cascade,
  submission_notes text,review_status text default 'pending');
alter table public.task_submissions enable row level security;
grant usage on schema public to authenticated,service_role;
grant select,insert,update,delete on public.task_submissions,public.developer_tasks to authenticated,service_role;
-- Deliberately reproduce even broader access than the historical org policy.
create policy fixture_legacy_submission_access on public.task_submissions for all to authenticated using(true) with check(true);
-- Apply migration before the following assertions.
\ir ../../supabase/migrations/20260911094725_production_submission_write_authority.sql
begin;
insert into public.developer_tasks values(1),(2);
insert into public.task_submissions(id,task_id,submission_notes) values(1,1,'Original'),(2,2,'Cascade');
do $$ declare actor_role text; changed int; begin
  foreach actor_role in array array['owner','admin','manager','developer'] loop
    perform set_config('request.jwt.claims',jsonb_build_object('app_metadata',jsonb_build_object('role',actor_role,'user_type',
      case when actor_role='developer' then 'developer' else 'admin' end))::text,true);
    set local role authenticated;
    if (select count(*) from public.task_submissions)<>2 then raise exception 'SELECT changed for %',actor_role; end if;
    begin
      insert into public.task_submissions(id,task_id) values(3,1);
      raise exception 'Direct INSERT permitted for %',actor_role;
    exception when insufficient_privilege then null;
    end;
    update public.task_submissions set submission_notes='Forged',review_status='approved' where id=1;
    get diagnostics changed=row_count;
    if changed<>0 then raise exception 'Direct UPDATE permitted for %',actor_role; end if;
    delete from public.task_submissions where id=1;
    get diagnostics changed=row_count;
    if changed<>0 then raise exception 'Direct DELETE permitted for %',actor_role; end if;
    reset role;
  end loop;
  if (select submission_notes from public.task_submissions where id=1) <> 'Original' then raise exception 'Proof changed'; end if;
  -- service_role BYPASSRLS is what Supabase's verified APIs use. Give the
  -- fixture role this production attribute even if another suite created it.
end $$;
alter role service_role bypassrls;
set local role service_role;
insert into public.task_submissions(id,task_id,submission_notes) values(3,1,'Service');
update public.task_submissions set review_status='approved' where id=3;
do $$ begin
  if (select review_status from public.task_submissions where id=3)<>'approved' then raise exception 'Trusted UPDATE failed'; end if;
end $$;
delete from public.task_submissions where id=3;
reset role;
do $$ begin
  if exists(select 1 from public.task_submissions where id=3) then raise exception 'Trusted DELETE failed'; end if;
end $$;
-- Parent authorization is a separate boundary. Its authorized FK cascade
-- must still remove children even though direct child DELETE is denied.
set local role authenticated;
delete from public.developer_tasks where id=2;
reset role;
do $$ begin
  if exists(select 1 from public.task_submissions where id=2) then raise exception 'Authorized parent cascade blocked'; end if;
  if not exists(select 1 from public.task_submissions where id=1) then raise exception 'Unrelated proof deleted'; end if;
end $$;
rollback;
