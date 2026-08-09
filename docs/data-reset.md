# Data reset

`scripts/reset-data.mjs` returns the database to day zero so manual testing can
start from a fresh signup. It deletes **data**. It never touches **structure**.

There is no undo. Read the checklist before you run anything.

---

## Before you run this

- [ ] **Take a Supabase backup.** Dashboard → Database → Backups → *Create
      backup*, and wait for it to finish. On a plan without on-demand backups,
      take a `pg_dump` instead. Nothing in this script can restore what it
      removes; the backup is the only way back.
- [ ] **Confirm the project ref.** Check the ref in the Supabase dashboard URL
      and confirm it is the project you mean to empty. The script will not run
      without you typing it, and refuses if it disagrees with `.env.local`.
- [ ] **Know that your own account goes too.** The owner account you are logged
      in with is deleted along with everything else — the app row *and* the
      Supabase Auth account. When the script finishes you cannot log in at all
      until you sign up again.
- [ ] **Tell anyone else using the system.** Every organisation is removed, not
      just yours. If a customer or a teammate has data in this project, it is
      gone.
- [ ] **Check nothing else is mid-flight.** Stripe webhooks in `billing_events`
      and desktop-tracker uploads land continuously; anything that arrives
      after the script reads its counts will still be there afterwards. Run it
      when the system is quiet, or just run it twice.

---

## Running it

### Dry run — this is the default

```
node scripts/reset-data.mjs --project=isaccqqjobuwfeaxlrwc
```

Reads only. Prints the full delete plan: every table in the order it would be
emptied with its row count and the reason it sits where it does, every Supabase
Auth account by email, and every storage object that would be removed, broken
down by bucket. Changes nothing. Run this first, and read it.

### The real thing

```
node scripts/reset-data.mjs --project=isaccqqjobuwfeaxlrwc --confirm-delete-everything
```

The flag is deliberately long. `-y` and `--force` are not accepted. The script
also pauses for five seconds before touching anything, so `Ctrl-C` still saves
you.

`--project=` is mandatory in **both** modes and must match the ref in
`NEXT_PUBLIC_SUPABASE_URL`. If they disagree the script aborts and prints both
values. A `.env.local` left pointing at the wrong project is the one mistake
here that cannot be walked back, so the ref has to be stated, not inferred.

### Options

| Flag | Effect |
| --- | --- |
| `--project=<ref>` | Required. Aborts on mismatch with `.env.local`. |
| `--confirm-delete-everything` | The only accepted confirmation. |
| `--wipe-plan-catalogue` | Also empty `billing_plans`. Kept by default — see below. |
| `--keep-documents-root` | Leave the root-level objects in the public `documents` bucket. They are project requirement files, and are removed by default. |

Credentials come from `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. The key is
never printed and never written anywhere.

---

## What it deletes

### Database rows

Tables are emptied children-first, in an order derived by reading the foreign
key declarations in `database/*.sql`. The dry run prints the order together
with the FK that puts each table where it is, so the ordering can be audited
rather than trusted.

Two constraints do real work:

- `projects.assigned_to → developers(id) ON DELETE CASCADE`
  (`cascade_deletion_migration.sql:60`). Emptying `developers` first would drag
  every project down with it, so `projects` is emptied first and reports its
  own count.
- `developers.user_id → auth.users(id)` with **no** on-delete action
  (`schema.sql:10`). Auth accounts therefore cannot be removed until the
  `developers` rows are gone. Auth deletion runs last.

The tiers, briefly: desktop telemetry → task-level children → submissions →
tasks → project-level children → projects → org-scoped records → membership
graph (invitations, memberships, teams, departments) → identity tables
(clients, developers, admin_users) → organizations.

### Supabase Auth accounts

**This is the step that will block you if it is skipped.** Deleting rows from
`admin_users` / `developers` / `clients` leaves the accounts in `auth.users`
untouched, and those accounts own the email addresses.

The failure is quiet, not loud. `/api/auth/signup` calls
`auth.admin.createUser` and then ignores its error
(`src/app/api/auth/signup/route.js:165`). Sign up again with an email that
still has a stale Auth account and the request returns **success** — it creates
the `admin_users` row, the organization and the owner membership — but
`auth_user_id` stays `NULL`, so the account it just told you about can never
log in. You would be left deleting rows by hand to try again.

The script enumerates every Auth account through the admin API, prints them by
email during the dry run, and deletes them after the database rows.

### Storage objects

Deleting the rows does not delete the files they point at. Six buckets exist in
this project and the script handles all of them:

| Bucket | Visibility | What happens |
| --- | --- | --- |
| `monitoring` | private | Emptied. Screenshots written after migration 019. |
| `screenshots` | **public** | Emptied. The legacy screenshot bucket the desktop tracker wrote to before 019 — this is where the images actually still are. |
| `org-files` | private | Emptied. Employee photos, project docs, comment attachments. |
| `invoices` | private | Emptied. Invoice PDFs. |
| `task-submissions` | private | Emptied. Proof-of-work uploads. |
| `documents` | **public** | Emptied. Project requirement documents at the bucket root (`projects.file_url` points straight at them), plus `org-logos/` and the legacy `screenshots/` tree. The dry run breaks this bucket down by top-level prefix before anything is removed. |

Anything the script cannot classify or cannot remove is listed under
**LEFT BEHIND** in the report rather than silently ignored.

---

## What survives

**The schema, in full.** No `DROP`, no `ALTER`, no `CREATE`. Every table,
column, index, constraint, RLS policy, function and trigger installed by
migrations 010–049 is untouched. No migration needs re-running afterwards.

**`billing_plans` — the plan catalogue (kept by default).**

This is the table often called "subscription plans"; there is no table by that
name in this schema. Migration 027 creates it as `billing_plans` and its own
header calls it a *"catalogue of purchasable plans. NOT org-scoped"*. It has no
`organization_id`, so it is configuration, not tenant data.

It is kept for three reasons:

1. Emptying it breaks billing. Signup writes an `organization_subscriptions`
   row with `plan_code = 'free'`; with no matching plan the pricing page is
   blank and checkout has no `stripe_price_id` to send.
2. It breaks *quietly*, which is worse. `plan_limit_for()` in
   `028_plan_limit_triggers.sql:60` looks the limit up, falls back to the
   `free` plan, then does `coalesce(lim, -1)`. With the catalogue empty every
   limit resolves to `-1` — unlimited — so every plan-limit trigger silently
   stops enforcing. Testing after the reset would pass limits that production
   would reject, which is exactly the wrong way for a test environment to lie.
3. The rows carry no tenant identifiers, no Stripe customers and no history, so
   keeping them costs a clean test nothing.

Pass `--wipe-plan-catalogue` if you want it emptied anyway. Migration 027's
seed inserts are `on conflict (code) do nothing`, so re-running that file
restores the four plans — but only if someone remembers to.

**`role_permissions` — the global RBAC matrix (kept).** Same class of thing:
seeded by the 011 backfill, no `organization_id`, read by every permission
check.

**Relations the script does not recognise.** These are reported with their row
counts and left alone, so an unknown table is never wiped on a guess. At the
time of writing that is `developer_sessions` and `login_preferences`, both
empty. If one of them starts holding tenant data, add it to `DELETE_ORDER` in
the script.

---

## If it fails halfway

Run it again. Every step is idempotent: deleting from an already-empty table is
a no-op, removing an absent object is a no-op, and Auth accounts are re-listed
on each run rather than replayed from a stale list. Rows are deleted in batches
keyed on the primary key, and after the ordered pass the script sweeps up to
three more times over anything still holding rows. Partial runs are expected to
be finished by simply re-running.

---

## After it finishes

The script prints rows deleted per table, Auth accounts removed by email,
storage objects removed, anything left behind, and then:

1. There are no accounts at all. You cannot log in.
2. Go to **`/admin/registration`** and sign up again. That flow calls
   `/api/auth/signup`, which creates the `admin_users` row, the organization,
   the owner membership and the Supabase Auth account in one step.
3. Your old email address is free again, because the Auth account that held it
   is gone and `createUser` has nothing to collide with.
4. Schema, policies, functions, triggers and the plan catalogue are unchanged.
   Nothing needs re-applying.
