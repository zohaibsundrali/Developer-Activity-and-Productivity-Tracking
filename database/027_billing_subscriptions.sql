-- =====================================================================
--  027 - SaaS billing and subscriptions
-- =====================================================================
--  Additive only. No existing table, column, policy or trigger is altered or
--  dropped. Every organization keeps working exactly as before until a
--  subscription row exists for it; absence of a row means "free plan", which is
--  how existing tenants are treated.
--
--  FIVE TABLES
--   billing_plans          catalogue of purchasable plans. NOT org-scoped -
--                          it is the same list for every tenant, readable by
--                          any authenticated user so the pricing page renders.
--   organization_subscriptions   one row per organization. The only source of
--                          truth for entitlement, and it is written ONLY by the
--                          service role from a verified Stripe webhook.
--   billing_events         every Stripe event id seen, so a redelivered webhook
--                          is a no-op. Stripe retries on any non-2xx and can
--                          deliver the same event more than once by design.
--   billing_invoices       invoice history mirrored from Stripe for display,
--                          so the billing page does not call Stripe on render.
--   organization_usage_snapshots   optional periodic counts, for showing usage
--                          trends without recounting on every page load.
--
--  WHY NO CLIENT WRITE POLICIES
--   A browser must never be able to set its own plan, status or period end. All
--   four billing tables are readable by owner/admin and writable by nobody -
--   the service role bypasses RLS, and it is the only writer.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no double-quoted
--  identifiers - the target SQL editor mangles both. It also resolves an entire
--  paste before running it, so statements that CREATE a table are kept in an
--  earlier PART than statements that reference it, and it shows only the LAST
--  statement's result, so verify queries must be run one at a time.
--
--  Run each PART as its own query.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - Tables
-- ---------------------------------------------------------------------

create table if not exists public.billing_plans (id uuid primary key default gen_random_uuid(), code text not null unique, name text not null, description text, stripe_price_id text, stripe_product_id text, amount_cents integer not null default 0, currency text not null default 'usd', billing_interval text not null default 'month', trial_days integer not null default 0, limits jsonb not null default '{}'::jsonb, features jsonb not null default '{}'::jsonb, is_active boolean not null default true, sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table if not exists public.organization_subscriptions (id uuid primary key default gen_random_uuid(), organization_id uuid not null unique references public.organizations(id) on delete cascade, plan_code text not null default 'free', status text not null default 'trialing', stripe_customer_id text, stripe_subscription_id text, stripe_price_id text, current_period_start timestamptz, current_period_end timestamptz, trial_start timestamptz, trial_end timestamptz, cancel_at_period_end boolean not null default false, canceled_at timestamptz, ended_at timestamptz, grace_period_ends_at timestamptz, last_payment_status text, last_payment_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table if not exists public.billing_events (id uuid primary key default gen_random_uuid(), stripe_event_id text not null unique, event_type text not null, organization_id uuid references public.organizations(id) on delete set null, payload jsonb, processed_at timestamptz, processing_error text, created_at timestamptz not null default now());

create table if not exists public.billing_invoices (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, stripe_invoice_id text not null unique, stripe_subscription_id text, status text, amount_due_cents integer, amount_paid_cents integer, currency text default 'usd', hosted_invoice_url text, invoice_pdf_url text, period_start timestamptz, period_end timestamptz, issued_at timestamptz, created_at timestamptz not null default now());

create table if not exists public.organization_usage_snapshots (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, captured_at timestamptz not null default now(), usage jsonb not null default '{}'::jsonb);


-- ---------------------------------------------------------------------
--  PART 2 - Indexes and constraints
-- ---------------------------------------------------------------------

create index if not exists idx_org_subscriptions_org on public.organization_subscriptions (organization_id);
create index if not exists idx_org_subscriptions_status on public.organization_subscriptions (status);
create index if not exists idx_org_subscriptions_stripe_sub on public.organization_subscriptions (stripe_subscription_id);
create index if not exists idx_org_subscriptions_stripe_cust on public.organization_subscriptions (stripe_customer_id);
create index if not exists idx_billing_events_type_created on public.billing_events (event_type, created_at desc);
create index if not exists idx_billing_invoices_org_issued on public.billing_invoices (organization_id, issued_at desc);
create index if not exists idx_usage_snapshots_org_captured on public.organization_usage_snapshots (organization_id, captured_at desc);

alter table public.organization_subscriptions drop constraint if exists org_subscriptions_status_check;
alter table public.organization_subscriptions add constraint org_subscriptions_status_check check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'));

alter table public.billing_plans drop constraint if exists billing_plans_interval_check;
alter table public.billing_plans add constraint billing_plans_interval_check check (billing_interval in ('month', 'year'));


-- ---------------------------------------------------------------------
--  PART 3 - Row level security
-- ---------------------------------------------------------------------
--  Read: owner and admin of the owning organization, never a client.
--  Write: nobody. The webhook handler uses the service role, which bypasses
--  RLS, so a browser cannot grant itself a plan by writing a row.

alter table public.billing_plans enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.organization_usage_snapshots enable row level security;

drop policy if exists billing_plans_read on public.billing_plans;
create policy billing_plans_read on public.billing_plans for select to authenticated using (is_active = true);

drop policy if exists org_subscriptions_read on public.organization_subscriptions;
create policy org_subscriptions_read on public.organization_subscriptions for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and public.auth_role() in ('owner', 'admin'));

drop policy if exists billing_invoices_read on public.billing_invoices;
create policy billing_invoices_read on public.billing_invoices for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and public.auth_role() in ('owner', 'admin'));

drop policy if exists usage_snapshots_read on public.organization_usage_snapshots;
create policy usage_snapshots_read on public.organization_usage_snapshots for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and public.auth_role() in ('owner', 'admin'));

-- billing_events is deliberately left with RLS on and NO policy: it is an
-- internal webhook ledger holding raw Stripe payloads, and nothing in the
-- browser has any reason to read it.


-- ---------------------------------------------------------------------
--  PART 4 - Seed the plan catalogue
-- ---------------------------------------------------------------------
--  The stripe_price_id values are NULL on purpose. They are filled in from the
--  Stripe dashboard once the products exist - see PART 6. A plan with a null
--  price id cannot be checked out; the free plan never needs one.
--
--  Limits are per organization. -1 means unlimited. Keys match the RESOURCES
--  map in src/utils/entitlements.js; adding a key here without adding it there
--  simply has no effect, which is the safe direction.

insert into public.billing_plans (code, name, description, amount_cents, currency, billing_interval, trial_days, sort_order, limits, features) values ('free', 'Free', 'For trying the product out.', 0, 'usd', 'month', 14, 0, '{"employees": 3, "developers": 3, "projects": 2, "active_tasks": 50, "storage_mb": 100, "screenshots": 500, "tracking_history_days": 7}'::jsonb, '{"reports": false, "automation": false, "client_portal": false, "api_access": false}'::jsonb) on conflict (code) do nothing;

insert into public.billing_plans (code, name, description, amount_cents, currency, billing_interval, trial_days, sort_order, limits, features) values ('professional', 'Professional', 'For a growing team.', 4900, 'usd', 'month', 14, 1, '{"employees": 25, "developers": 25, "projects": 25, "active_tasks": 2000, "storage_mb": 5000, "screenshots": 25000, "tracking_history_days": 90}'::jsonb, '{"reports": true, "automation": true, "client_portal": true, "api_access": false}'::jsonb) on conflict (code) do nothing;

insert into public.billing_plans (code, name, description, amount_cents, currency, billing_interval, trial_days, sort_order, limits, features) values ('business', 'Business', 'For multiple teams.', 14900, 'usd', 'month', 14, 2, '{"employees": 100, "developers": 100, "projects": 150, "active_tasks": 20000, "storage_mb": 50000, "screenshots": 200000, "tracking_history_days": 365}'::jsonb, '{"reports": true, "automation": true, "client_portal": true, "api_access": true}'::jsonb) on conflict (code) do nothing;

insert into public.billing_plans (code, name, description, amount_cents, currency, billing_interval, trial_days, sort_order, limits, features) values ('enterprise', 'Enterprise', 'Unlimited, with support.', 49900, 'usd', 'month', 0, 3, '{"employees": -1, "developers": -1, "projects": -1, "active_tasks": -1, "storage_mb": -1, "screenshots": -1, "tracking_history_days": -1}'::jsonb, '{"reports": true, "automation": true, "client_portal": true, "api_access": true}'::jsonb) on conflict (code) do nothing;


-- ---------------------------------------------------------------------
--  PART 5 - Put every existing organization on the free plan
-- ---------------------------------------------------------------------
--  Without a row an organization has no entitlement record. The application
--  treats a missing row as the free plan anyway, but seeding one means the
--  billing page has something to show and the trial clock starts from today
--  rather than from whenever the org was created.

insert into public.organization_subscriptions (organization_id, plan_code, status, trial_start, trial_end) select o.id, 'free', 'trialing', now(), now() + interval '14 days' from public.organizations o where not exists (select 1 from public.organization_subscriptions s where s.organization_id = o.id);


-- =====================================================================
--  PART 6 - AFTER creating the products in the Stripe dashboard
-- =====================================================================
--  Create three recurring prices in Stripe TEST mode, then run one UPDATE per
--  plan with the price id Stripe generated. Until this is done, Checkout will
--  refuse those plans with a clear message rather than failing at Stripe.
--
-- update public.billing_plans set stripe_price_id = 'price_REPLACE_ME_PROFESSIONAL' where code = 'professional';
-- update public.billing_plans set stripe_price_id = 'price_REPLACE_ME_BUSINESS' where code = 'business';
-- update public.billing_plans set stripe_price_id = 'price_REPLACE_ME_ENTERPRISE' where code = 'enterprise';


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
-- select code, name, amount_cents, trial_days, stripe_price_id from public.billing_plans order by sort_order;
-- select count(*) as orgs_with_subscription from public.organization_subscriptions;
-- select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('billing_plans','organization_subscriptions','billing_invoices','organization_usage_snapshots','billing_events') order by tablename, policyname;
