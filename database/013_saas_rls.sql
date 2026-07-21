-- =====================================================================
--  SaaS Phase 6 — Part 3: ROW LEVEL SECURITY (true DB-level isolation)
-- =====================================================================
--  Enables RLS so a request can only touch its own organization's rows.
--  - Website users are authenticated (Supabase Auth JWT carrying
--    app_metadata.organization_id) -> policies scope them by org.
--  - The desktop app uses the service_role key -> bypasses RLS entirely,
--    so it keeps writing tracking data unchanged.
--  - The anon key with no JWT -> auth_org() is null -> sees nothing.
--
--  A generic BEFORE INSERT trigger stamps organization_id from the row's
--  developer/admin/project/email links, so rows inserted by service_role
--  routes or the desktop app still get the right org (and stay visible to
--  the org's authenticated reads).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Generic org stamper (security definer so it can read the link tables)
-- ---------------------------------------------------------------------
create or replace function public.stamp_org() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  r jsonb := to_jsonb(NEW);
  org uuid;
begin
  if (r ? 'organization_id') and (r->>'organization_id') is not null then
    return NEW;
  end if;
  select coalesce(
    (select d.organization_id from public.developers d
       where d.id::text = coalesce(r->>'developer_id', r->>'user_id', r->>'assigned_developer_id') limit 1),
    (select a.organization_id from public.admin_users a
       where a.id::text = r->>'admin_id' limit 1),
    (select p.organization_id from public.projects p
       where p.id::text = r->>'project_id' limit 1),
    (select d.organization_id from public.developers d
       where lower(d.email) = lower(nullif(coalesce(r->>'user_email', r->>'developer_email', r->>'email'), '')) limit 1)
  ) into org;
  if org is not null then
    NEW.organization_id := org;
  end if;
  return NEW;
end $$;

-- ---------------------------------------------------------------------
-- Group A — website-owned tables: full org isolation
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'projects','developers','developer_tasks','task_submissions',
    'productivity_metrics','notifications','memberships','teams',
    'departments','invitations','admin_users'
  ] loop
    if to_regclass('public.'||t) is null then continue; end if;
    -- stamp org on insert (backstop for service_role inserts)
    execute format('drop trigger if exists trg_stamp_org on public.%I', t);
    execute format('create trigger trg_stamp_org before insert on public.%I for each row execute function public.stamp_org()', t);
    -- enable RLS + org policy for authenticated users
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists org_isolation on public.%I', t);
    execute format($f$create policy org_isolation on public.%I for all to authenticated
      using (organization_id = public.auth_org())
      with check (organization_id = public.auth_org())$f$, t);
  end loop;
end $$;

-- organizations: keyed by id
alter table public.organizations enable row level security;
drop policy if exists org_self on public.organizations;
create policy org_self on public.organizations for all to authenticated
  using (id = public.auth_org()) with check (id = public.auth_org());

-- role_permissions: global config, readable by any authenticated user
alter table public.role_permissions enable row level security;
drop policy if exists rp_read on public.role_permissions;
create policy rp_read on public.role_permissions for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- Group B — desktop-written tracking: asymmetric (write open, read org)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'productivity_sessions','keyboard_stats','mouse_activities','app_usage',
    'screenshots','developer_logins','browser_usage','developer_activities'
  ] loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('drop trigger if exists trg_stamp_org on public.%I', t);
    execute format('create trigger trg_stamp_org before insert on public.%I for each row execute function public.stamp_org()', t);
    execute format('alter table public.%I enable row level security', t);
    -- inserts stay open (desktop app / anon can write tracking)
    execute format('drop policy if exists track_insert on public.%I', t);
    execute format('create policy track_insert on public.%I for insert with check (true)', t);
    -- reads are org-scoped for authenticated users
    execute format('drop policy if exists track_read on public.%I', t);
    execute format('create policy track_read on public.%I for select to authenticated using (organization_id = public.auth_org())', t);
  end loop;
end $$;

commit;
