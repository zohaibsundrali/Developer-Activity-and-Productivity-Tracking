-- Fresh isolated database. Reuse attachment fixture and its real invoker helper.
\set ON_ERROR_STOP on
\ir task_attachment_integrity.sql
create table storage.buckets(id text primary key,public boolean);
insert into storage.buckets values('task-submissions',false);
alter table storage.objects enable row level security;
-- Broad old grants deliberately model forgotten permissive policies.
create policy legacy_storage on storage.objects for all to authenticated using(true) with check(true);
grant insert,update,delete on storage.objects to authenticated;
\ir ../../supabase/migrations/20260911102625_production_pm_storage_task_scope.sql
insert into storage.objects values('monitoring','unrelated','{}'),('task-submissions','submissions/legacy/proof.pdf','{}');
set role authenticated;
select set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000012","app_metadata":{"user_type":"developer"}}',false);
do $$ declare visible_count int; path text:='pm/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000101/new.pdf'; bad_path text; changed int; begin
 select count(*) into visible_count from storage.objects where name like 'pm/%';
 if visible_count<>1 then raise exception 'PM scope did not exclude hidden/foreign tasks'; end if;
 insert into storage.objects values('task-submissions',path,'{"size":1}');
 update storage.objects set metadata='{"size":2}' where name=path;
 foreach bad_path in array array[
  'pm/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000102/private.pdf',
  'pm/00000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000103/foreign.pdf',
  'pm/not-an-org/not-a-task/file.pdf','pm/00000000-0000-0000-0000-000000000001/no-task.pdf'] loop
  begin
   insert into storage.objects values('task-submissions',bad_path,'{}');
   raise exception 'Unauthorized PM upload accepted';
  exception when insufficient_privilege then null; end;
  begin
   update storage.objects set name=bad_path where name=path;
   raise exception 'Storage move crossed task boundary';
  exception when insufficient_privilege then null; end;
 end loop;
 delete from storage.objects where name=path; get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Collaborator could not remove orphan after attachment row deletion'; end if;
 if (select count(*) from storage.objects where name not like 'pm/%')<>2 then raise exception 'Unrelated object rules changed'; end if;
end $$;
reset role;
update memberships set status='suspended' where user_id='00000000-0000-0000-0000-000000000012';
set role authenticated;
do $$ begin if exists(select 1 from storage.objects where name like 'pm/%') then raise exception 'Suspended collaborator retained PM access'; end if; end $$;
reset role;
