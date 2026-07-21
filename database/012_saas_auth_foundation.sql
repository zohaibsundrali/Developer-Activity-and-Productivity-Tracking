-- =====================================================================
--  SaaS Phase 6 — Part 1: AUTH FOUNDATION (additive, non-breaking)
-- =====================================================================
--  Prepares Supabase Auth + RLS WITHOUT changing current behaviour.
--  Applied to the project on migration day. The custom-auth login keeps
--  working until the website login is switched over (Part 2).
--
--  NOTE: the Supabase Auth USERS themselves were created via the Auth Admin
--  API (auth.admin.createUser) — one per existing admin_users/developers row,
--  keeping their current passwords (now properly hashed in auth.users), with
--  app_metadata = { organization_id, role, user_type, app_user_id }. That step
--  is data (not SQL) and is documented here for the record.
-- =====================================================================

-- 1) Identity link columns (app row -> auth user)
alter table public.admin_users add column if not exists auth_user_id uuid;
alter table public.developers  add column if not exists auth_user_id uuid;

-- 2) Helper: current user's organization_id, read from the JWT app_metadata
--    claim (Supabase includes app_metadata in the access token natively, so no
--    custom access-token hook is required). RLS policies use this in Part 2.
create or replace function public.auth_org() returns uuid
  language sql stable
  as $$ select nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id','')::uuid $$;

-- Verified: signing in a migrated user returns a JWT whose
-- app_metadata.organization_id matches their org, so public.auth_org() resolves
-- correctly and is ready to back org-scoped RLS policies.
