-- =====================================================================
--  036 - email_log: a delivery record for every outbound email
-- =====================================================================
--  Until now the product sent mail and kept nothing. Three routes each built
--  their own nodemailer Gmail transport, every failure was swallowed by a
--  try/catch, and Gmail throttles silently - so "the client says they never
--  got the invitation" had no answer anywhere in the system. This table is
--  that answer: one row per send attempt, with the provider, the provider's
--  own message id, the error if there was one, and how many attempts it took.
--
--  WHO CAN READ IT
--   Owners and admins of the owning organization, and nobody else. An email
--   log is a list of who was contacted, when, and about what - it is closer to
--   an audit trail than to application data, and a developer or a client has
--   no business reading it. Clients are excluded explicitly, the same way
--   every other staff table is.
--
--  WHO CAN WRITE IT
--   Only the service role. There is deliberately NO insert, update or delete
--   policy, so RLS denies every write from a browser session holding the anon
--   key. The send path (src/utils/emailProvider.js) writes with the service
--   role, which bypasses RLS. A log a caller can forge or erase is not a log.
--
--  organization_id is NULLABLE on purpose: a verification code sent during
--  signup and an invitation to a not-yet-existing member have no org yet.
--  Those rows are readable by nobody through RLS (null never equals auth_org),
--  which is the correct default - they are only reachable with the service key.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting, no double-quoted identifiers - the target SQL editor mangles all
--  three. A column is created in an earlier PART than anything referencing it,
--  because that editor resolves a whole paste before running any of it. It
--  also shows only the LAST statement's result, so verify queries go one at a
--  time. Run each PART as its own query.
--
--  Idempotent: every statement is if-not-exists or drop-then-create, so
--  re-running the whole file is a no-op.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - Table and columns
-- ---------------------------------------------------------------------
--  status    queued -> sent | failed | mocked.
--            'queued' is written before the attempt, so a process that dies
--            mid-send leaves evidence instead of silence.
--            'mocked' is a real outcome, not an error: it means no provider
--            was configured and the message was recorded rather than dropped.
--  provider  which seam handled it - resend, smtp, or mock.
--  attempts  how many tries the send took. A row with attempts > 1 is a
--            transient provider failure that recovered; that is exactly the
--            signal that used to be invisible.
--  error     redacted before it reaches this column. Never contains a key.
--
--  The alter statements below the create exist so an environment that already
--  has a partial email_log converges to this shape instead of failing.

create table if not exists public.email_log (id uuid primary key default gen_random_uuid());

alter table public.email_log add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.email_log add column if not exists recipient text not null default '';
alter table public.email_log add column if not exists template text;
alter table public.email_log add column if not exists subject text;
alter table public.email_log add column if not exists status text not null default 'queued';
alter table public.email_log add column if not exists provider text;
alter table public.email_log add column if not exists provider_message_id text;
alter table public.email_log add column if not exists error text;
alter table public.email_log add column if not exists attempts integer not null default 0;
alter table public.email_log add column if not exists created_at timestamptz not null default now();
alter table public.email_log add column if not exists sent_at timestamptz;


-- ---------------------------------------------------------------------
--  PART 2 - Constraints (AFTER the columns exist)
-- ---------------------------------------------------------------------
--  A check rather than an enum type: adding a status to an enum needs an
--  alter type, which cannot run inside the same transaction as a statement
--  that uses the new value. A check constraint is dropped and recreated in
--  one line, which is also what makes this file re-runnable.

alter table public.email_log drop constraint if exists email_log_status_check;
alter table public.email_log add constraint email_log_status_check check (status in ('queued', 'sent', 'failed', 'mocked'));

alter table public.email_log drop constraint if exists email_log_attempts_check;
alter table public.email_log add constraint email_log_attempts_check check (attempts >= 0);


-- ---------------------------------------------------------------------
--  PART 3 - Indexes (AFTER the columns exist)
-- ---------------------------------------------------------------------
--  The admin view is "this org's email history, newest first" - a composite
--  index in exactly that order answers it without a sort.
--  The status index backs the other question the table gets asked: "what
--  failed", and "what is still queued", both across all orgs, from a job or a
--  health check.

create index if not exists idx_email_log_org_created on public.email_log (organization_id, created_at desc);
create index if not exists idx_email_log_status on public.email_log (status);
create index if not exists idx_email_log_recipient on public.email_log (lower(recipient));


-- ---------------------------------------------------------------------
--  PART 4 - Row level security (AFTER the columns exist)
-- ---------------------------------------------------------------------
--  SELECT for owners and admins of the owning org. No write policy of any
--  kind, which under RLS means no write is possible for anon or authenticated.
--  The explicit revoke is belt and braces: a future grant to a role would
--  otherwise be gated only by the absence of a policy.

alter table public.email_log enable row level security;

drop policy if exists email_log_admin_read on public.email_log;
create policy email_log_admin_read on public.email_log for select to authenticated using (organization_id is not null and organization_id = public.auth_org() and not public.auth_is_client() and public.auth_role() in ('owner', 'admin'));

revoke insert, update, delete, truncate on public.email_log from authenticated;
revoke insert, update, delete, truncate on public.email_log from anon;
revoke all on public.email_log from anon;
grant select on public.email_log to authenticated;


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
-- select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'email_log' order by ordinal_position;
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.email_log'::regclass order by conname;
-- select indexname from pg_indexes where schemaname = 'public' and tablename = 'email_log' order by indexname;
-- select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'email_log';
-- select relrowsecurity from pg_class where oid = 'public.email_log'::regclass;
-- select status, count(*) from public.email_log group by status order by status;
