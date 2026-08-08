-- =====================================================================
--  030 - Billing event ordering and Stripe identifier uniqueness
-- =====================================================================
--  Additive only. One new nullable column and three indexes on
--  organization_subscriptions. No existing column, policy, trigger or row is
--  altered or dropped, so every organization keeps working exactly as before.
--
--  WHY last_event_at
--   Stripe guarantees that a webhook is DELIVERED, never the order it arrives
--   in. A customer.subscription.updated carrying 'active' can land after the
--   customer.subscription.deleted that ended the subscription. Applied blindly
--   that revives the row - status back to active, ended_at and canceled_at
--   nulled - and the organization keeps paid limits forever with no
--   subscription left at Stripe to bill or cancel.
--
--   last_event_at stores the Stripe event.created of the newest event already
--   applied to the row, which is the only value that orders two events against
--   each other (arrival time reflects retries, not sequence). The webhook
--   refuses any event older than the watermark. NULL means no event has been
--   applied yet, so the first one through always wins - existing rows seeded by
--   027 PART 5 are therefore unaffected.
--
--  WHY the unique indexes
--   027 gave stripe_customer_id and stripe_subscription_id plain indexes.
--   resolveOrganizationId in the webhook maps an incoming Stripe object back to
--   an organization through exactly those two columns with limit(1) and no
--   ordering, so two rows sharing an identifier would route billing events to
--   an arbitrary, unstable organization: one tenant's payment upgrading
--   another's plan. Uniqueness makes that unrepresentable rather than merely
--   unlikely.
--
--   Both are PARTIAL on 'is not null'. Every free organization has NULL in both
--   columns and there are many of them; a plain unique index would be fine in
--   Postgres (NULLs never collide) but the partial form also keeps the index
--   small and states the intent - uniqueness applies to real Stripe ids only.
--
--  IF EITHER UNIQUE INDEX FAILS TO CREATE
--   Duplicates already exist and the create is refused. That is the migration
--   working: the rows must be reconciled by hand, because only a human can say
--   which organization the Stripe customer really belongs to. The VERIFY
--   queries at the bottom list any duplicates.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting, no double-quoted identifiers - the target SQL editor mangles them.
--  It also resolves an entire paste before running it, so the statement that
--  CREATES the column is in an earlier PART than the index that references it.
--
--  Run each PART as its own query. Re-running any PART is safe.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - Column
-- ---------------------------------------------------------------------
--  Nullable with no default and no backfill: a synthetic watermark would be a
--  guess about when the current state was applied, and guessing high would make
--  the webhook discard real events.

alter table public.organization_subscriptions add column if not exists last_event_at timestamptz;

comment on column public.organization_subscriptions.last_event_at is 'Stripe event.created of the newest subscription event applied to this row. The billing webhook ignores any event older than this so an out-of-order delivery cannot reinstate a cancelled subscription. NULL means none applied yet.';


-- ---------------------------------------------------------------------
--  PART 2 - Indexes
-- ---------------------------------------------------------------------
--  PART 1 must have run first: the last index references last_event_at.

create unique index if not exists uq_org_subscriptions_stripe_cust on public.organization_subscriptions (stripe_customer_id) where stripe_customer_id is not null;

create unique index if not exists uq_org_subscriptions_stripe_sub on public.organization_subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;

create index if not exists idx_org_subscriptions_last_event on public.organization_subscriptions (last_event_at desc);


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
--  The first two must return zero rows. Run them BEFORE PART 2 if this is a
--  database that has been taking live webhooks - a non-empty result is what
--  would make the unique index creation fail, and it names the rows to fix.
--
-- select stripe_customer_id, count(*) from public.organization_subscriptions where stripe_customer_id is not null group by stripe_customer_id having count(*) > 1;
-- select stripe_subscription_id, count(*) from public.organization_subscriptions where stripe_subscription_id is not null group by stripe_subscription_id having count(*) > 1;
-- select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'organization_subscriptions' and column_name = 'last_event_at';
-- select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'organization_subscriptions' order by indexname;
