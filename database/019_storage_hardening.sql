-- =====================================================================
--  019 - Storage hardening: private monitoring bucket
-- =====================================================================
--  Fixes audit finding H2 (public `documents` bucket holds monitoring
--  screenshots, employee photos, org logos and project docs with no policy
--  in version control).
--
--  WHAT THIS DOES
--   Creates a PRIVATE bucket `monitoring` for screen captures - the most
--   sensitive artefact the product stores. Objects are keyed
--   `{organization_id}/{developer_id}/{ts}-{uuid}.png`, and the policies below
--   let a member sign an object only when the leading folder equals their own
--   organization. Clients are excluded outright.
--
--   Legacy screenshots stay in the public `documents` bucket under the
--   `screenshots/` prefix and keep rendering from their stored public_url.
--   Move those objects across when convenient - see the count query at the
--   bottom. Nothing breaks in the meantime.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no double-quoted
--  identifiers - the target SQL editor mangles all three.
--
--  IMPORTANT: the Supabase SQL editor runs the whole script in ONE TRANSACTION.
--  If any statement fails the entire migration rolls back.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('monitoring', 'monitoring', false, 10485760, array['image/png','image/jpeg','image/webp']) on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists monitoring_read on storage.objects;
drop policy if exists monitoring_insert on storage.objects;
drop policy if exists monitoring_update on storage.objects;
drop policy if exists monitoring_delete on storage.objects;

create policy monitoring_read on storage.objects for select to authenticated using (bucket_id = 'monitoring' and not public.auth_is_client() and (storage.foldername(name))[1] = public.auth_org()::text);
create policy monitoring_insert on storage.objects for insert to authenticated with check (bucket_id = 'monitoring' and not public.auth_is_client() and (storage.foldername(name))[1] = public.auth_org()::text);
create policy monitoring_update on storage.objects for update to authenticated using (bucket_id = 'monitoring' and public.auth_role() in ('owner','admin') and (storage.foldername(name))[1] = public.auth_org()::text) with check (bucket_id = 'monitoring' and (storage.foldername(name))[1] = public.auth_org()::text);
create policy monitoring_delete on storage.objects for delete to authenticated using (bucket_id = 'monitoring' and public.auth_role() in ('owner','admin') and (storage.foldername(name))[1] = public.auth_org()::text);

-- =====================================================================
--  VERIFY - expected: 4 rows, all scoped to bucket_id = 'monitoring'
-- =====================================================================
-- select policyname, cmd, roles::text from pg_policies where schemaname = 'storage' and policyname like 'monitoring%' order by policyname;

-- =====================================================================
--  LEGACY CLEANUP TRACKER - screenshots still in the public bucket
-- =====================================================================
-- select count(*) as still_public from public.screenshots where storage_path like 'screenshots/%' or storage_path is null;
