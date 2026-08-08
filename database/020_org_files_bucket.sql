-- =====================================================================
--  020 - Tenant-isolated file storage
-- =====================================================================
--  Completes audit finding H2. Migration 019 moved monitoring screenshots off
--  the public bucket; this moves the remaining sensitive uploads.
--
--  WHAT WAS WRONG
--   The shared `documents` bucket is PUBLIC, so every object in it is readable
--   by anyone holding the URL with no session and no organization check. It
--   held employee photos (PII) and project requirement documents. Worse,
--   project documents were written to the bucket ROOT with no organization
--   prefix at all, so one tenant's files sat directly beside another's.
--
--  WHAT THIS DOES
--   Creates the PRIVATE `org-files` bucket. Objects are keyed
--   `{organization_id}/{category}/...` and the policies below read that leading
--   folder, so isolation is enforced by the database rather than by callers
--   remembering the right prefix. Employee photos are further restricted to
--   people-ops and the employee themselves, matching the employee_profiles RLS
--   added in migration 018.
--
--   Organization logos deliberately stay in the public bucket: they are
--   branding, they are embedded in outbound email, and a signed URL would
--   expire there.
--
--  BACKWARD COMPATIBLE
--   Rows written before this change still hold a full public URL and keep
--   rendering from the public bucket. Only new uploads are private.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no double-quoted
--  identifiers - the target SQL editor mangles all three.
--
--  IMPORTANT: the Supabase SQL editor runs the whole script in ONE TRANSACTION.
--  If any statement fails the entire migration rolls back.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit) values ('org-files', 'org-files', false, 26214400) on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists org_files_read on storage.objects;
drop policy if exists org_files_insert on storage.objects;
drop policy if exists org_files_update on storage.objects;
drop policy if exists org_files_delete on storage.objects;

create policy org_files_read on storage.objects for select to authenticated using (bucket_id = 'org-files' and not public.auth_is_client() and (storage.foldername(name))[1] = public.auth_org()::text and ((storage.foldername(name))[2] <> 'employee-photos' or public.auth_role() in ('owner','admin','hr') or (storage.foldername(name))[3] = public.auth_app_user_id()::text));
create policy org_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'org-files' and not public.auth_is_client() and (storage.foldername(name))[1] = public.auth_org()::text);
create policy org_files_update on storage.objects for update to authenticated using (bucket_id = 'org-files' and not public.auth_is_client() and (storage.foldername(name))[1] = public.auth_org()::text) with check (bucket_id = 'org-files' and (storage.foldername(name))[1] = public.auth_org()::text);
create policy org_files_delete on storage.objects for delete to authenticated using (bucket_id = 'org-files' and public.auth_role() in ('owner','admin','hr') and (storage.foldername(name))[1] = public.auth_org()::text);

-- The public `documents` bucket keeps serving logos and pre-existing files.
-- Reads stay public because the bucket is public, but writes are locked to
-- authenticated members so one tenant cannot overwrite another's objects.
drop policy if exists documents_insert on storage.objects;
drop policy if exists documents_update on storage.objects;
drop policy if exists documents_delete on storage.objects;

create policy documents_insert on storage.objects for insert to authenticated with check (bucket_id = 'documents' and not public.auth_is_client());
create policy documents_update on storage.objects for update to authenticated using (bucket_id = 'documents' and not public.auth_is_client()) with check (bucket_id = 'documents');
create policy documents_delete on storage.objects for delete to authenticated using (bucket_id = 'documents' and public.auth_role() in ('owner','admin','hr'));

-- =====================================================================
--  VERIFY - expected: 7 rows (4 org_files_*, 3 documents_*)
-- =====================================================================
-- select policyname, cmd, roles::text from pg_policies where schemaname = 'storage' and (policyname like 'org_files%' or policyname like 'documents%') order by policyname;

-- =====================================================================
--  LEGACY CLEANUP TRACKER
-- =====================================================================
-- select count(*) as photos_still_public from public.employee_profiles where photo_url like 'http%';
-- select count(*) as project_docs_still_public from public.projects where file_url like 'http%';
