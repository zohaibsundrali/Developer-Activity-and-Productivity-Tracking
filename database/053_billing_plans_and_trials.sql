-- =====================================================================
--  053 - Seed the plan catalogue, move trials to 7 days, give every
--        organization a subscription row
-- =====================================================================
--  WHY THIS IS NEEDED AT ALL
--
--  Migration 027 created the whole billing schema and included a seed for the
--  four plans. The tables exist on the live project; the seed never landed.
--  Measured on 2026-08-10:
--
--    billing_plans               0 rows
--    organization_subscriptions  0 rows
--    organizations               1 row
--
--  So there is no catalogue to choose from, no organization has a
--  subscription, and `resolveEntitlement` falls all the way through to the
--  hardcoded FALLBACK_FREE_LIMITS in src/utils/entitlements.js. The billing
--  screen renders an empty plan grid. Nothing is broken exactly - it is simply
--  that the billing system has never been switched on.
--
--  WHAT THIS FILE DOES
--
--   PART 1  seeds (or re-seeds) the four plans, with a 7-day trial.
--   PART 2  gives every organization that has no subscription row a free one,
--           so nobody is locked out by the arrival of a gate.
--   PART 3  puts the owner's own organization on enterprise permanently.
--
--  It creates no columns and drops nothing. Every statement is idempotent:
--  re-running it converges rather than duplicating.
--
--  TRIAL LENGTH: 7 DAYS, NOT 14
--
--  027 seeded `trial_days = 14` on free, professional and business. The
--  product decision is 7. Free is set to 0 - free is not a trial, it is a
--  plan you can stay on forever, and giving it a "trial" would mean the free
--  tier expires, which is not what free means. Enterprise stays 0 because it
--  is sold, not self-served.
--
--  `api_access` IS SET TO false ON EVERY PLAN, DELIBERATELY
--
--  027 seeded it true on business and enterprise. There is no API. A green
--  tick beside a feature that does not exist is a claim made to someone about
--  to spend $149 or $499 a month, and `hasFeature` reads a missing or false
--  flag as not granted - so false is both honest and the fail-closed
--  direction. If an API is built later, this is one update statement.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting, no double-quoted identifiers. Run each PART as its own query.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 0 - READ-ONLY. Confirm the state before changing it.
-- ---------------------------------------------------------------------
--  Expect 0, 0 and 1 on the live project before PART 1.

-- select 'billing_plans' as tbl, count(*) from public.billing_plans union all select 'organization_subscriptions', count(*) from public.organization_subscriptions union all select 'organizations', count(*) from public.organizations;

--  Which organization PART 3 will put on enterprise. Expect exactly one row.

-- select o.id, o.name, a.email as owner_email from public.organizations o join public.admin_users a on a.id = o.owner_id where lower(btrim(a.email)) = 'zohaib6511@gmail.com';


-- ---------------------------------------------------------------------
--  PART 1 - The plan catalogue
-- ---------------------------------------------------------------------
--  `on conflict (code) do update` rather than `do nothing`, on purpose. 027
--  used `do nothing`, which is why a partially-applied seed can never be
--  corrected by re-running it. This form converges: whatever is in the table
--  ends up matching what is written here.
--
--  `stripe_price_id` is NOT touched by these statements. It is set separately
--  (see the bottom of 027) and clobbering it here would silently disconnect
--  checkout from Stripe.
--
--  Limits: -1 means unlimited. The keys match RESOURCES in
--  src/utils/entitlements.js exactly; a key that does not appear there is
--  never read by anything.

insert into public.billing_plans (code, name, description, amount_cents, currency, billing_interval, trial_days, sort_order, is_active, limits, features) values ('free', 'Free', 'For trying the product out.', 0, 'usd', 'month', 0, 0, true, '{"employees": 3, "developers": 3, "projects": 2, "active_tasks": 50, "storage_mb": 100, "screenshots": 500, "tracking_history_days": 7}'::jsonb, '{"reports": false, "automation": false, "client_portal": false, "api_access": false}'::jsonb) on conflict (code) do update set name = excluded.name, description = excluded.description, amount_cents = excluded.amount_cents, currency = excluded.currency, billing_interval = excluded.billing_interval, trial_days = excluded.trial_days, sort_order = excluded.sort_order, is_active = excluded.is_active, limits = excluded.limits, features = excluded.features, updated_at = now();

insert into public.billing_plans (code, name, description, amount_cents, currency, billing_interval, trial_days, sort_order, is_active, limits, features) values ('professional', 'Professional', 'For a growing team.', 4900, 'usd', 'month', 7, 1, true, '{"employees": 25, "developers": 25, "projects": 25, "active_tasks": 2000, "storage_mb": 5000, "screenshots": 25000, "tracking_history_days": 90}'::jsonb, '{"reports": true, "automation": true, "client_portal": true, "api_access": false}'::jsonb) on conflict (code) do update set name = excluded.name, description = excluded.description, amount_cents = excluded.amount_cents, currency = excluded.currency, billing_interval = excluded.billing_interval, trial_days = excluded.trial_days, sort_order = excluded.sort_order, is_active = excluded.is_active, limits = excluded.limits, features = excluded.features, updated_at = now();

insert into public.billing_plans (code, name, description, amount_cents, currency, billing_interval, trial_days, sort_order, is_active, limits, features) values ('business', 'Business', 'For multiple teams.', 14900, 'usd', 'month', 7, 2, true, '{"employees": 100, "developers": 100, "projects": 150, "active_tasks": 20000, "storage_mb": 50000, "screenshots": 200000, "tracking_history_days": 365}'::jsonb, '{"reports": true, "automation": true, "client_portal": true, "api_access": false}'::jsonb) on conflict (code) do update set name = excluded.name, description = excluded.description, amount_cents = excluded.amount_cents, currency = excluded.currency, billing_interval = excluded.billing_interval, trial_days = excluded.trial_days, sort_order = excluded.sort_order, is_active = excluded.is_active, limits = excluded.limits, features = excluded.features, updated_at = now();

insert into public.billing_plans (code, name, description, amount_cents, currency, billing_interval, trial_days, sort_order, is_active, limits, features) values ('enterprise', 'Enterprise', 'Unlimited, with support.', 49900, 'usd', 'month', 0, 3, true, '{"employees": -1, "developers": -1, "projects": -1, "active_tasks": -1, "storage_mb": -1, "screenshots": -1, "tracking_history_days": -1}'::jsonb, '{"reports": true, "automation": true, "client_portal": true, "api_access": false}'::jsonb) on conflict (code) do update set name = excluded.name, description = excluded.description, amount_cents = excluded.amount_cents, currency = excluded.currency, billing_interval = excluded.billing_interval, trial_days = excluded.trial_days, sort_order = excluded.sort_order, is_active = excluded.is_active, limits = excluded.limits, features = excluded.features, updated_at = now();


-- ---------------------------------------------------------------------
--  PART 2 - Every organization gets a subscription row
-- ---------------------------------------------------------------------
--  FREE AND ACTIVE, NOT TRIALING. This is the statement that decides whether
--  shipping the trial gate locks existing customers out of their own data.
--
--  An organization created before billing existed never agreed to a trial and
--  never chose a plan. Starting a 7-day clock on it would mean that a week
--  after this migration runs, every one of them is bounced to a payment screen
--  for a product they were already using. `status = 'active'` on the free plan
--  can never expire, so the gate simply does not apply to them - they keep
--  working, on free limits, until they choose to upgrade.
--
--  New organizations are different: they pick a plan during signup and the
--  route stamps the trial there (src/app/api/auth/signup/route.js).

insert into public.organization_subscriptions (organization_id, plan_code, status) select o.id, 'free', 'active' from public.organizations o where not exists (select 1 from public.organization_subscriptions s where s.organization_id = o.id);


-- ---------------------------------------------------------------------
--  PART 3 - The owner's own organization, on enterprise, permanently
-- ---------------------------------------------------------------------
--  A ONE-OFF for this deployment, matched by the owner's email rather than a
--  pasted uuid so it is readable and so it cannot silently hit the wrong row.
--  It is safe to re-run and it is a no-op on any deployment where that address
--  does not own an organization.
--
--  No trial_end and status 'active': the gate keys off an elapsed trial, so
--  leaving both trial columns null is what makes this permanent rather than
--  a 7-day grant. Building the product from inside a locked-out account is not
--  a position worth being in.
--
--  To move a DIFFERENT organization onto enterprise later, change the address
--  on this line. To take it back, set plan_code to 'free'.

update public.organization_subscriptions set plan_code = 'enterprise', status = 'active', trial_start = null, trial_end = null, grace_period_ends_at = null, updated_at = now() where organization_id in (select o.id from public.organizations o join public.admin_users a on a.id = o.owner_id where lower(btrim(a.email)) = 'zohaib6511@gmail.com');


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
--  Four plans. Trial should read 0, 7, 7, 0 and api_access false on all four.

-- select code, name, amount_cents / 100 as dollars, trial_days, features ->> 'api_access' as api_access, is_active from public.billing_plans order by sort_order;

--  Every organization has exactly one subscription, and the owner's is
--  enterprise/active with no trial end.

-- select o.name, s.plan_code, s.status, s.trial_end from public.organizations o left join public.organization_subscriptions s on s.organization_id = o.id order by o.name;

--  Nobody is in a state the gate would lock: expect 0 rows.

-- select o.name, s.plan_code, s.status, s.trial_end from public.organization_subscriptions s join public.organizations o on o.id = s.organization_id where s.status = 'trialing' and s.plan_code <> 'free' and s.trial_end is not null and s.trial_end < now();


-- =====================================================================
--  ROLLBACK
-- =====================================================================
--  There is nothing structural to undo. To return to the pre-migration state
--  (an empty catalogue and no subscriptions), which turns billing back off:

-- delete from public.organization_subscriptions;
-- delete from public.billing_plans;
