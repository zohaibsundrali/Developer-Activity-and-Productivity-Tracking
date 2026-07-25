-- =====================================================================
-- STORAGE_invoices_bucket.sql
-- ---------------------------------------------------------------------
-- Creates the PRIVATE `invoices` storage bucket used for invoice PDFs.
-- Run once in the Supabase SQL editor. Only needed if you use invoice-PDF
-- upload/download; the rest of the client portal works without it.
--
-- Client downloads go through /api/client/invoices/[id]/pdf which signs the
-- path with the service role, so the bucket must stay PRIVATE.
-- Admin uploads happen in the browser with the admin's JWT, so we add a
-- storage RLS policy that lets staff (non-clients) manage objects ONLY inside
-- their own organization's folder ("<organization_id>/<invoiceId>/<file>").
-- Depends on the auth_is_client() / auth_org() helpers from migration 014.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists "invoices org staff all" on storage.objects;
create policy "invoices org staff all" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'invoices'
    and not public.auth_is_client()
    and (storage.foldername(name))[1] = public.auth_org()::text
  )
  with check (
    bucket_id = 'invoices'
    and not public.auth_is_client()
    and (storage.foldername(name))[1] = public.auth_org()::text
  );

-- Verify:
--   select id, name, public from storage.buckets where id = 'invoices';  -- public=false
