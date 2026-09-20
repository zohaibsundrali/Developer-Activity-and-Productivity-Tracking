-- Disposable database only; never run this fixture in production.
\set ON_ERROR_STOP on
\ir platform_owner_console.sql
alter table auth.sessions add column if not exists aal text default 'aal1';
create table if not exists auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text);
alter table organizations add column if not exists updated_at timestamptz;
alter table memberships add column if not exists updated_at timestamptz,add column if not exists created_at timestamptz default now();
\set ON_ERROR_STOP on
alter table billing_plans add column if not exists name text,add column if not exists amount_cents int default 0,add column if not exists currency text default 'usd',add column if not exists billing_interval text default 'month',add column if not exists stripe_price_id text,add column if not exists sort_order int default 0;
alter table organization_subscriptions add column if not exists id uuid default gen_random_uuid(),add column if not exists created_at timestamptz default now(),add column if not exists updated_at timestamptz default now(),add column if not exists ended_at timestamptz,add column if not exists last_payment_at timestamptz;
alter table billing_invoices add column if not exists stripe_invoice_id text,add column if not exists stripe_subscription_id text,add column if not exists issued_at timestamptz;
create table if not exists billing_events(id uuid default gen_random_uuid(),stripe_event_id text,event_type text,organization_id uuid,payload jsonb,processed_at timestamptz,processing_error text,created_at timestamptz default now());
alter table tracker_devices add column if not exists revoked_at timestamptz,add column if not exists expires_at timestamptz default now()+interval '1 day',add column if not exists created_at timestamptz default now(),add column if not exists name text,add column if not exists platform text;
create table if not exists tracker_device_presence(device_id uuid,received_at timestamptz);
alter table storage.objects add column if not exists metadata jsonb;

-- Test the exact file supplied for the Supabase SQL Editor.
\ir ../platform-admin-suite-setup.sql
\set platform_suite_installed 1
\ir platform_management.sql
\ir platform_projects.sql
\ir platform_billing_suite.sql
select 'Complete platform suite upgrade and integration checks passed' as result;
