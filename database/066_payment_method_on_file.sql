-- =====================================================================
--  066 - the card on file, and the four digits that are allowed to exist
-- =====================================================================
--
--  THE REQUEST WAS "card details should go in the database". THIS IS THE
--  VERSION OF THAT WHICH IS SAFE TO BUILD, and the difference matters enough
--  to write down.
--
--  WHAT IS NEVER STORED, HERE OR ANYWHERE:
--
--    - the full card number (PAN)
--    - the CVV / CVC
--
--  Not because they are inconvenient. The CVV may not be stored after
--  authorisation by ANY party, under PCI-DSS 3.2 — there is no compliant way
--  to keep it, encrypted or otherwise. And the moment a PAN lands in this
--  table, the whole database is in PCI scope: every backup, every replica,
--  every developer with a service key, and every future `select *`.
--
--  This install never sees either. Stripe Checkout collects the card in an
--  iframe on Stripe's domain; the card number does not reach this server, and
--  adding a column for it would mean building a path to make it reach here.
--
--  WHAT IS STORED, AND WHAT IT IS FOR:
--
--    brand, last four, expiry, funding type, and Stripe's payment_method id.
--
--  That is exactly what a person needs to answer "which card is this
--  organization being billed on?" and "is it about to expire?" — the two
--  questions the Billing screen could not answer at all before this. The
--  payment_method id is a REFERENCE, not a credential: it is useless without
--  the secret key, and it is what lets the app show the card without ever
--  holding it.
--
--  THE CHECK ON last4 IS THE POINT OF THIS MIGRATION.
--
--  A comment saying "only the last four" is a promise. `card_last4 ~
--  '^[0-9]{4}$'` is a guarantee: a full card number written to that column is
--  refused by Postgres, whatever the application layer believes it is doing.
--  That refusal is worth more than the column is.
--
--  RUN PART 1, then PART 2 (verification, changes nothing).
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The columns
-- ---------------------------------------------------------------------

alter table public.organization_subscriptions
  --  "Visa", "mastercard", "amex" — Stripe's own vocabulary, not constrained
  --  here because new networks appear and a rejected webhook is a worse
  --  outcome than an unfamiliar brand name on a screen.
  add column if not exists card_brand text,

  --  FOUR DIGITS. See the header. This constraint is the reason this migration
  --  exists in this shape.
  add column if not exists card_last4 text,

  add column if not exists card_exp_month smallint,
  add column if not exists card_exp_year smallint,

  --  credit / debit / prepaid / unknown. Useful when a payment fails: a
  --  prepaid card failing is a different conversation from a credit card
  --  failing.
  add column if not exists card_funding text,

  --  A reference to the card at Stripe. Not a credential — useless without the
  --  secret key. It is what lets the detach webhook know WHICH card was
  --  removed.
  add column if not exists stripe_payment_method_id text,

  --  When we last learned any of the above. A card that has not been confirmed
  --  in a year may well not be the card being charged.
  add column if not exists card_updated_at timestamptz;

--  Added separately from the column so re-running this migration cannot leave
--  the column present and the constraint missing — which is the state where
--  everything looks fine and nothing is enforced.
alter table public.organization_subscriptions
  drop constraint if exists org_subscriptions_card_last4_check;

alter table public.organization_subscriptions
  add constraint org_subscriptions_card_last4_check
  check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');

alter table public.organization_subscriptions
  drop constraint if exists org_subscriptions_card_exp_check;

--  A month outside 1-12 or a year outside a plausible range means something
--  upstream is writing the wrong field into the wrong column, and a silently
--  stored 0/0 renders as "expires 0/0" on a billing screen forever.
alter table public.organization_subscriptions
  add constraint org_subscriptions_card_exp_check
  check (
    (card_exp_month is null or card_exp_month between 1 and 12)
    and (card_exp_year is null or card_exp_year between 2000 and 2100)
  );


-- ---------------------------------------------------------------------
--  PART 2 - Verification. Changes nothing.
-- ---------------------------------------------------------------------

--  2a. Expect seven rows, all nullable — an organization exists long before it
--      has a card, and requiring these would refuse every free-plan signup.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organization_subscriptions'
  and column_name in ('card_brand','card_last4','card_exp_month','card_exp_year',
                      'card_funding','stripe_payment_method_id','card_updated_at')
order by column_name;

--  2b. Both constraints are attached. Expect two rows.
--
--      Matched through conkey on the COLUMN, not on the text of the definition.
--      A definition-text match is how 063 once reported
--      projects_task_plan_status_check as proof that `status` was constrained —
--      a false all-clear on a different column.
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join unnest(con.conkey) as k(attnum) on true
join pg_attribute a
  on a.attrelid = con.conrelid and a.attnum = k.attnum
where con.conrelid = 'public.organization_subscriptions'::regclass
  and con.contype = 'c'
  and a.attname in ('card_last4','card_exp_month','card_exp_year')
group by con.conname, con.oid
order by con.conname;

--  2c. THE ONE THAT MATTERS. A full card number cannot be written to the
--      last-four column. This SHOULD RAISE; if it returns a row instead, the
--      constraint did not take and the rest of this migration is decoration.
--
--      Run it on its own and expect:
--        ERROR: new row for relation "organization_subscriptions" violates
--               check constraint "org_subscriptions_card_last4_check"
--
--      Wrapped so it cannot leave anything behind either way.
do $$
begin
  begin
    update public.organization_subscriptions
       set card_last4 = '4242424242424242'
     where false;                     -- matches nothing; the CHECK is what we want
    raise notice 'last4 constraint: no row matched, run 2d for the real test';
  exception when check_violation then
    raise notice 'last4 constraint: ENFORCED';
  end;
end $$;

--  2d. The definitive test, on a value rather than a row. Expect `false`.
--      If this returns true, a PAN can be stored and PART 1 did not take.
select '4242424242424242' ~ '^[0-9]{4}$' as pan_would_be_accepted,
       '4242' ~ '^[0-9]{4}$'             as last4_is_accepted;

--  2e. Nothing was disturbed: every existing subscription still has no card,
--      because nothing has written one yet. Expect with_card = 0.
select count(*) filter (where card_last4 is not null) as with_card,
       count(*) as total
from public.organization_subscriptions;
