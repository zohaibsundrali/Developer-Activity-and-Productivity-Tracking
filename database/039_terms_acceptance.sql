-- =====================================================================
--  039 - terms_acceptances: a durable record that a human agreed to the Terms
-- =====================================================================
--  Additive only. No existing table, column, index, policy or trigger is
--  renamed, dropped, loosened or altered. Nothing that works today stops
--  working because this table exists.
--
--  WHY THIS EXISTS
--   src/content/legal/terms.js is a complete Terms of Service, and
--   src/app/terms/page.js renders it - but until this migration the product
--   recorded NOTHING about anyone agreeing to it. A document that is merely
--   reachable from a footer is browsewrap: the weakest form of assent there
--   is, and the first thing an opposing party attacks.
--
--   That matters more here than it would in most products. The Terms carry the
--   customer's obligation to lawfully notify the people this product monitors
--   (screenshots, application usage) before switching the agent on. If the
--   Terms are unenforceable for want of assent, that obligation may not bind
--   the customer either - and the party left holding the exposure is us.
--
--   This table is the evidence: who agreed, to which version, when, and
--   through which door.
--
--  ---------------------------------------------------------------------
--  WHY A SEPARATE TABLE AND NOT A COLUMN ON memberships
--  ---------------------------------------------------------------------
--   The obvious cheap alternative is two columns on public.memberships -
--   terms_accepted_version + terms_accepted_at. It was rejected for three
--   reasons, in descending order of importance.
--
--   1. A column cannot hold a history, and history is the entire point.
--      The Terms will be updated. When they are, the product will want to
--      require re-acceptance of the new version. With a column, recording
--      that re-acceptance OVERWRITES the record of the old one - the evidence
--      that this customer agreed to v1 is destroyed at exactly the moment it
--      becomes contentious, because a dispute about conduct that happened
--      under v1 is argued after v2 has shipped. An UPDATE that erases the only
--      proof of the previous agreement is not an audit trail. A table appends;
--      the old row stays.
--
--   2. Acceptance is an event; a membership row is current state.
--      memberships answers "what is this person allowed to do right now" and
--      is mutated freely - role changes, team moves, suspension, deletion when
--      someone leaves. An acceptance is a thing that happened at an instant
--      and must never change afterwards. Storing an immutable event inside a
--      mutable state row means every future writer of that row is one careless
--      update away from corrupting legal evidence. Deliberately there is no FK
--      to memberships here: removing a member must not delete the record that
--      they once agreed.
--
--   3. One row per acceptance generalises; one column pair does not.
--      document is a column, not an assumption, so a Privacy Policy or a DPA
--      can be recorded here later without another migration and without three
--      more columns bolted onto memberships.
--
--   The cost of the table over the column is one extra insert on two code
--   paths and one join for the "who is on an old version" query. That query -
--   select the latest acceptance per member, compare document_version against
--   the current meta - is the whole reason to store a version rather than a
--   boolean, and it is only answerable at all because of the shape chosen
--   here.
--
--  ---------------------------------------------------------------------
--  WHO WRITES IT
--  ---------------------------------------------------------------------
--   Only the service role, from src/app/api/auth/signup/route.js and
--   src/app/api/invitations/accept/route.js. There is deliberately NO insert,
--   update or delete policy below, and the writes are additionally revoked
--   from authenticated and anon. Under RLS, a command with no policy is denied
--   to every non-superuser role, so a browser holding the anon key and a valid
--   session cannot append a forged acceptance, cannot rewrite the version it
--   accepted, and cannot delete the row. An acceptance record that its own
--   subject can create or destroy proves nothing.
--
--  WHO READS IT
--   A member may read their OWN acceptances. Owners and admins may read every
--   acceptance in their own organisation - they are the ones who have to
--   answer "has everybody agreed to the current version". Nobody can read
--   another organisation's rows, and no role can read another member's rows
--   except owner and admin within the same org.
--
--  ---------------------------------------------------------------------
--  EXISTING USERS ARE NOT AFFECTED
--  ---------------------------------------------------------------------
--   Everyone who signed up before this migration has no row here, and that is
--   correct: they did not accept anything, and inventing a row saying they did
--   would be a fabricated legal record. Nothing anywhere reads this table as a
--   precondition. No column is added to any existing table, so no existing row
--   becomes invalid; login, session issuance and every existing route are
--   untouched and cannot be gated on acceptance by this file alone. Requiring
--   the existing population to accept retroactively is a separate product
--   decision with its own UX (an interstitial on next sign-in), not something
--   a schema migration should impose.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no dollar
--  quoting, no double-quoted identifiers - the target SQL editor mangles all
--  three. It resolves an entire paste before running any of it, so a column is
--  created in an EARLIER PART than any statement referencing it, and it shows
--  only the LAST statement's result, so the verify queries at the bottom must
--  be run one at a time. Run each PART as its own query.
--
--  Idempotent: every statement is if-not-exists or drop-then-create, so the
--  whole file can be re-run safely.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - Table and columns
-- ---------------------------------------------------------------------
--  organization_id   the customer that is bound. NOT NULL: an acceptance that
--                    belongs to no organisation binds nobody and could never
--                    be produced in a dispute. Both writing routes have the
--                    org id in hand before they insert. ON DELETE CASCADE is
--                    a deliberate trade: the row carries an email and an IP,
--                    which are personal data about a named individual, and
--                    retaining them after the tenant is erased would sit badly
--                    with the same data-protection duties the Terms exist to
--                    discharge. Deleting a tenant is a service-role operation
--                    that no browser session can reach, so this is not a route
--                    by which a subject can destroy their own record.
--
--  user_id           the profile row id - admin_users.id, developers.id or
--                    clients.id. The same (user_id, user_type) pair that
--                    public.memberships uses, and the same value the JWT
--                    carries as app_metadata.app_user_id, which is what makes
--                    the own-row read policy in PART 4 possible. No FK,
--                    because it points at one of three tables depending on
--                    user_type, and because the record must outlive the
--                    profile row.
--
--  user_type         which of those three tables user_id refers to. Same
--                    vocabulary as memberships.user_type after migration 014.
--
--  email             who agreed, in terms a human reading the record can
--                    recognise, captured as it stood at that instant. A person
--                    can change their address later; the evidence should say
--                    what it said on the day.
--
--  document          which document was accepted. 'terms_of_service' today.
--                    Present so a privacy policy or DPA needs no new table.
--
--  document_version  the version of that document. Sourced from the `meta`
--                    export of src/content/legal/terms.js. That module has no
--                    `version` field, so the routes pass meta.lastUpdated (an
--                    ISO date, currently 2026-08-09), which is the only
--                    identifier the document actually carries and is the same
--                    string the rendered page shows the user. text, not date:
--                    if a real semantic version is added to meta later it
--                    stores unchanged, and comparing versions is an equality
--                    test, never arithmetic.
--                    THIS COLUMN IS THE POINT OF THE TABLE. A boolean cannot
--                    answer "who accepted the version containing clause 3.5";
--                    this can, and it is what lets a future update identify
--                    exactly who is still on an old version.
--
--  entry_point       'signup' (this person created the organisation and bound
--                    it) or 'invitation' (this person was invited into an
--                    organisation somebody else created). Materially different
--                    acts of assent, and one character of storage to tell them
--                    apart afterwards.
--
--  accepted_at       when. Server clock, never client-supplied.
--
--  ip                the address the acceptance arrived from, when the route
--                    already had it on the request. Nullable and genuinely
--                    optional: no request plumbing was added to obtain it and
--                    a null here weakens nothing that matters. inet rather
--                    than text so a malformed value is rejected at the door
--                    instead of accumulating as junk in an evidence table -
--                    the routes validate and pass null rather than guess.
--                    Nothing else about the request is stored: no user agent,
--                    no headers, no body. This table needs to prove assent,
--                    not profile the person giving it.

create table if not exists public.terms_acceptances (id uuid primary key default gen_random_uuid());

alter table public.terms_acceptances add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.terms_acceptances add column if not exists user_id uuid;
alter table public.terms_acceptances add column if not exists user_type text;
alter table public.terms_acceptances add column if not exists email text;
alter table public.terms_acceptances add column if not exists document text not null default 'terms_of_service';
alter table public.terms_acceptances add column if not exists document_version text not null default 'unknown';
alter table public.terms_acceptances add column if not exists entry_point text not null default 'signup';
alter table public.terms_acceptances add column if not exists accepted_at timestamptz not null default now();
alter table public.terms_acceptances add column if not exists ip inet;


-- ---------------------------------------------------------------------
--  PART 2 - Constraints (AFTER the columns exist)
-- ---------------------------------------------------------------------
--  The three identity columns are set NOT NULL here rather than in the add
--  column statements above, because `add column if not exists` skips its own
--  clauses entirely on an environment that already has a partial table - the
--  alter below runs either way and makes both environments converge. There is
--  no default on any of them: an acceptance with a guessed subject is worse
--  than no acceptance, so a caller that omits one gets a loud error rather
--  than a plausible-looking row. This table is empty at the moment 039 runs
--  (nothing wrote to it before it existed), so setting NOT NULL cannot fail on
--  pre-existing data.
--
--  Checks rather than enum types: adding a value to an enum needs an ALTER
--  TYPE, which cannot run in the same transaction as a statement using the new
--  value. A check constraint is dropped and recreated in one line, which is
--  also what makes this file re-runnable.
--
--  document_version is checked non-empty. An empty version is indistinguish-
--  able from a boolean and would silently reintroduce the exact defect this
--  table exists to fix.

alter table public.terms_acceptances alter column organization_id set not null;
alter table public.terms_acceptances alter column user_id set not null;
alter table public.terms_acceptances alter column user_type set not null;

alter table public.terms_acceptances drop constraint if exists terms_acceptances_user_type_check;
alter table public.terms_acceptances add constraint terms_acceptances_user_type_check check (user_type in ('admin', 'developer', 'client'));

alter table public.terms_acceptances drop constraint if exists terms_acceptances_document_check;
alter table public.terms_acceptances add constraint terms_acceptances_document_check check (document in ('terms_of_service', 'privacy_policy', 'dpa'));

alter table public.terms_acceptances drop constraint if exists terms_acceptances_entry_point_check;
alter table public.terms_acceptances add constraint terms_acceptances_entry_point_check check (entry_point in ('signup', 'invitation'));

alter table public.terms_acceptances drop constraint if exists terms_acceptances_version_check;
alter table public.terms_acceptances add constraint terms_acceptances_version_check check (length(btrim(document_version)) > 0);


-- ---------------------------------------------------------------------
--  PART 3 - Indexes (AFTER the columns exist)
-- ---------------------------------------------------------------------
--  Three reads are foreseeable and each gets exactly one index.
--
--  org_accepted   "show this organisation's acceptances, newest first" - the
--                 admin-facing list, and the read the owner/admin policy in
--                 PART 4 serves. created-desc as the second key lets the
--                 planner satisfy the ORDER BY from the index.
--
--  subject        "what has this specific person accepted" - the own-row
--                 policy, and the per-member lookup behind a re-acceptance
--                 interstitial. Leads with organization_id so it also narrows
--                 by tenant first.
--
--  doc_version    "who is still on an old version" - the question that
--                 justifies storing a version at all. Filtering by
--                 (document, document_version) is how the re-acceptance
--                 campaign is built when the Terms change.
--
--  There is deliberately NO unique constraint on (organization_id, user_id,
--  user_type, document). Repeat acceptances are the feature: a member who
--  re-accepts an updated document must produce a SECOND row, not clobber the
--  first. Uniqueness here would silently turn this table back into a column.

create index if not exists idx_terms_acceptances_org_accepted on public.terms_acceptances (organization_id, accepted_at desc);
create index if not exists idx_terms_acceptances_subject on public.terms_acceptances (organization_id, user_id, user_type, accepted_at desc);
create index if not exists idx_terms_acceptances_doc_version on public.terms_acceptances (document, document_version);


-- ---------------------------------------------------------------------
--  PART 4 - Row level security (AFTER the columns exist)
-- ---------------------------------------------------------------------
--  Two SELECT policies and nothing else. Policies for the same command are
--  OR-ed, so these two are the complete set of ways a browser can see a row.
--
--  terms_acceptances_read_own
--    organization_id = auth_org()            tenant isolation, first
--    user_id  = auth_app_user_id()           the subject, from the JWT
--    user_type = auth_user_type()            disambiguates which profile table
--                                            user_id refers to. If the claim
--                                            is absent the comparison is null,
--                                            the policy is false, and the read
--                                            is denied - fail closed.
--
--  terms_acceptances_read_org_admin
--    organization_id = auth_org()            tenant isolation, first
--    not auth_is_client()                    a client is never staff. Belt and
--                                            braces on top of the role list,
--                                            the same shape as 036 and 038.
--    auth_role() in (owner, admin)           managers, team leads, HR,
--                                            developers and employees have no
--                                            business reading who else in the
--                                            company signed what.
--
--  NO insert, update or delete policy exists, and none should be added. Under
--  RLS a command with no policy is denied to every non-superuser role, so the
--  service role - which bypasses RLS and is what both writing routes use -
--  remains the only writer. The explicit revokes are belt and braces: without
--  them, a future blanket GRANT to authenticated would be held back only by
--  the absence of a policy. This is the same shape migration 036 uses for
--  email_log and 038 for system_events.
--
--  The consequence is the property that makes the row worth anything: the
--  person whose acceptance it records cannot create it, cannot alter the
--  version on it, and cannot delete it.

alter table public.terms_acceptances enable row level security;

drop policy if exists terms_acceptances_read_own on public.terms_acceptances;
create policy terms_acceptances_read_own on public.terms_acceptances for select to authenticated using (organization_id = public.auth_org() and user_id = public.auth_app_user_id() and user_type = public.auth_user_type());

drop policy if exists terms_acceptances_read_org_admin on public.terms_acceptances;
create policy terms_acceptances_read_org_admin on public.terms_acceptances for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client() and public.auth_role() in ('owner', 'admin'));

revoke insert, update, delete, truncate on public.terms_acceptances from authenticated;
revoke insert, update, delete, truncate on public.terms_acceptances from anon;
revoke all on public.terms_acceptances from anon;
grant select on public.terms_acceptances to authenticated;


-- =====================================================================
--  VERIFY (read-only). Run each on its own.
-- =====================================================================
-- select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'terms_acceptances' order by ordinal_position;
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.terms_acceptances'::regclass order by conname;
-- select indexname from pg_indexes where schemaname = 'public' and tablename = 'terms_acceptances' order by indexname;
-- select relrowsecurity from pg_class where oid = 'public.terms_acceptances'::regclass;
-- select policyname, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'terms_acceptances' order by policyname;
-- select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'terms_acceptances' order by grantee, privilege_type;
-- select document, document_version, count(*) from public.terms_acceptances group by document, document_version order by document, document_version;
