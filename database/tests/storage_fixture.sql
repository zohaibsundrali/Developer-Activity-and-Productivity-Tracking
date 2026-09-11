-- Isolated synthetic Storage metadata. Real files must always use Storage API.
create role service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create schema storage;
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,created_at timestamptz default now());
alter table screenshots add column storage_path text;
insert into storage.objects(bucket_id,name,metadata) values
('org-files','00000000-0000-0000-0000-000000000002/documents/existing.pdf','{"size":524288}');
