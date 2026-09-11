-- Synthetic Storage metadata only, in a fresh disposable database.
-- Production object deletion must use the Storage API with service authority.
create schema storage;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
-- Match the actual Supabase service role even when a prior fixture created it.
alter role service_role bypassrls;
create table storage.objects(id int primary key,bucket_id text not null,name text not null,metadata jsonb default '{}',unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,service_role;
grant all on storage.objects to authenticated,service_role;
create policy legacy_all on storage.objects for all to authenticated using(true) with check(true);
\ir ../../supabase/migrations/20260911095840_production_proof_object_immutability.sql
insert into storage.objects(id,bucket_id,name) values
 (1,'task-submissions','submissions/developer/project/task/proof.pdf'),
 (2,'task-submissions','pm/org/task/attachment.txt'),
 (3,'avatars','person.png');
set role authenticated;
insert into storage.objects(id,bucket_id,name) values(4,'task-submissions','submissions/developer/project/task/new.pdf');
do $$ declare affected int; begin
 if (select count(*) from storage.objects)<>4 then raise exception 'Proof SELECT unexpectedly changed'; end if;
 update storage.objects set metadata='{"size":999}' where id=1;
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Proof overwrite allowed'; end if;
 update storage.objects set name='pm/org/task/moved.pdf' where id=1;
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Proof move allowed'; end if;
 delete from storage.objects where id in(1,4);
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Proof deletion allowed'; end if;
 begin
   update storage.objects set name='submissions/developer/project/task/forged.pdf' where id=2;
   raise exception 'Attachment renamed into proof';
 exception when insufficient_privilege then null; end;
 update storage.objects set metadata='{"size":1}' where id in(2,3);
 get diagnostics affected=row_count;
 if affected<>2 then raise exception 'Ordinary object updates broken'; end if;
 delete from storage.objects where id=2;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'Attachment cleanup broken'; end if;
end $$;
reset role;
set role service_role;
delete from storage.objects where id in(1,4);
reset role;
do $$ begin
 if exists(select 1 from storage.objects where id in(1,4)) then raise exception 'Trusted retention cleanup broken'; end if;
end $$;
