# Screenshot bucket migration — moving employee screen captures out of public storage

**Status:** app code fixed, objects NOT yet moved, bucket NOT yet made private.
**Owner action required.** Verified against project `isaccqqjobuwfeaxlrwc` on 2026-08-09.

---

## 1. The finding

Every screen capture this product has ever taken is in a **public** storage bucket.
No session, no token, no organization membership — just the URL:

```
$ curl -o /dev/null -w '%{http_code} %{size_download}\n' \
    https://isaccqqjobuwfeaxlrwc.supabase.co/storage/v1/object/public/screenshots/\
zohaibawan6511/screenshot_20260705_105605_570_aaf3ae68.jpg
200 148554
```

That is a real employee's screen, served to an anonymous request.

Bucket state on the live project:

| bucket             | public | objects | note                                          |
| ------------------ | ------ | ------- | --------------------------------------------- |
| `screenshots`      | **yes**| **193** | where every capture actually is               |
| `documents`        | **yes**| 73      | project requirement documents — section 6     |
| `monitoring`       | no     | 0       | built by migration 019, never held an object  |
| `org-files`        | no     | —       | migration 020, working as intended            |
| `invoices`         | no     | —       | working as intended                           |
| `task-submissions` | no     | —       | working as intended                           |

Migration `019` created the private `monitoring` bucket and four policies. `040`
replaced `monitoring_read` with a per-person rule. **Neither has ever governed a
single object.**

The database side is fine, and worth saying so: an anonymous read of the
`screenshots` *table* returns `[]`. RLS is doing its job. The hole is entirely at
the storage layer, which RLS on `public.screenshots` cannot reach.

### 1.1 Why nobody noticed

Both `019` and this repository looked for the legacy captures in the wrong place.

`019` says legacy screenshots live in the public `documents` bucket under a
`screenshots/` **prefix**, and ships this progress query:

```sql
select count(*) as still_public from public.screenshots
 where storage_path like 'screenshots/%' or storage_path is null;
```

They are not there. They are in a **separate bucket named `screenshots`**, and
the stored paths carry no prefix at all:

```
zohaib6511/screenshot_20260705_105605_570_aaf3ae68.jpg
```

So that query has always returned **0**, and `legacyPublicScreenshotCount()` in
`src/utils/screenshotFiles.js` — which used the same `like 'screenshots/%'`
filter — always reported *zero rows left to migrate*. The cleanup looked finished
from the day it landed.

The read path failed in a matching way. `isPrivateScreenshot()` was:

```js
return Boolean(path) && !String(path).startsWith("screenshots/");
```

Because no real path starts with `screenshots/`, this returned `true` for **every
legacy row**. Each one was sent to `createSignedUrl()` against `monitoring`, where
the object does not exist; the call failed; and the `catch`/error branch quietly
served `row.public_url` — the world-readable URL. The images rendered, so nothing
looked broken, and the fallback that was supposed to be a temporary courtesy was
in fact the only code path that ever ran.

---

## 2. What has already been changed in this branch

Code only. **No object was moved, no row was rewritten, no bucket flag was
touched.**

### `src/app/api/upload-screenshot/route.js`

Already wrote to `monitoring` with the correct key shape before this work — that
part needed no change. What changed:

- The header comment claimed legacy objects sit in `documents` under a
  `screenshots/` prefix. Corrected to name the real bucket, so the next person
  does not inherit the error.
- The path-construction line now carries a comment explaining that segments 1 and
  2 are access control, not decoration, and naming the reader and the migration
  script that must agree with it.

### `src/utils/screenshotFiles.js`

The substantive fix. The classifier is now **positive** instead of negative:

```js
export function isMonitoringPath(path) {
  // {organization_id}/{developer_id}/{anything}
  // segment 1 must be an org uuid (or the `unassigned` sentinel)
  // segment 2 must be a developer uuid
}
```

A row is treated as private — and therefore signed — only when its key has the
shape `040`'s policy can actually read. Everything else is legacy. Consequences:

- **Signing is the default.** New uploads and migrated rows are always signed.
- **The public URL is an explicit, dated fallback.** `legacyPublicUrl()` carries a
  comment stating the two conditions under which it can be deleted outright
  (0 rows left to migrate, and the bucket made private).
- Legacy rows are no longer sent to the signing API at all, so the 88 pointless
  failing round-trips per gallery load stop.
- `legacyPublicScreenshotCount()` now counts *rows not in the monitoring shape*
  rather than a prefix that never matches. It returns **88** today; it returned 0
  before.

Nothing about the rendered output changes for a legacy row: it showed its
`public_url` before and it shows its `public_url` now. The difference is that the
code now says so on purpose rather than by accident, and can tell you how many
such rows remain.

### `scripts/migrate-screenshots.mjs` (new)

Dry-run-by-default object migration. Same guard-rail contract as
`scripts/reset-data.mjs`: `--project=<ref>` is required in both modes and must
match the ref in `.env.local`, and the only accepted confirmation is the full
`--confirm-migrate`.

It **copies only**. There is no delete path in the file, and it never changes a
bucket's public flag.

### `tests/screenshotPaths.test.js` (new)

28 tests: the key shape, the sentinel, rejection of the real legacy shape and of
the shape `019` wrongly assumed, agreement between route / reader / script, and
the read path preferring a signed URL over `public_url`.

---

## 3. The path shape, and why `040` requires exactly this one

Migrated objects are keyed:

```
{organization_id}/{developer_id}/{original basename}
```

`040` PART 15:

```sql
create policy monitoring_read on storage.objects for select to authenticated
using (bucket_id = 'monitoring'
   and not public.auth_is_client()
   and (storage.foldername(name))[1] = public.auth_org()::text
   and ((select public.auth_monitoring_sees_all())
        or public.auth_can_read_member(public.try_uuid((storage.foldername(name))[2]))));
```

- **Segment 1** is compared against `auth_org()`. Wrong value → invisible to
  everyone in every organization.
- **Segment 2** is parsed by `try_uuid()` and handed to `auth_can_read_member()`.
  This is the entire point of `040`: `019` checked segment 1 only, so any
  non-client colleague could mint a signed URL for anybody's screen capture.
  A non-uuid here resolves to `null`, and `auth_can_read_member(null)` is false,
  so the object falls back to owner/admin/hr only.

The policy has no `else`. An object anywhere else in the bucket is unreadable by
every authenticated caller.

`screenshots.developer_id` is the right value for segment 2: it equals
`memberships.user_id`, which is exactly the set `auth_monitoring_subjects()`
returns. Confirmed on this project — `developers.id` and `memberships.user_id`
are the same uuids for both developer rows.

**Why the original basename is kept** rather than a fresh `{ts}-{uuid}`: it makes
the migration idempotent (a run that dies halfway can just be re-run, where a
`Date.now()` name would copy everything twice), it keeps `screenshots.filename`
truthful without rewriting a second column, and it preserves the capture time
that the agent encoded in the filename — for some of these objects that is the
only timestamp they carry. Only segments 1 and 2 are read by any policy, so both
naming schemes satisfy `040`. New uploads from the route keep `{ts}-{uuid}.png`.

---

## 4. Dry run, as of 2026-08-09

```
$ node scripts/migrate-screenshots.mjs --project=isaccqqjobuwfeaxlrwc

  public.screenshots rows                         88
    already in the monitoring shape                0
    to migrate                                    88
    skipped                                        0

  objects in "screenshots" (public)             193
    referenced by a row                           88
    ORPHANED (no row points at them)             103
  objects in "monitoring" (private)               0

  MIGRATION PLAN  (88 objects, 8.4 MB)
  destination folders:
       49  unassigned/8fd69d30-13f6-45f1-904a-efeb2ab06dee/
       15  15e9b618-77d9-48a3-a32f-f1c4ba7b830b/ffb61eac-166e-4aff-a2f8-b779b86908fe/
       13  unassigned/fa42d1e2-28ff-48bd-988b-318c486dd7d1/
        9  681ca3ca-de35-4077-8a81-a1e079704526/e4c7637f-f1b9-477e-a3f2-9d0989b0c59a/
        2  unassigned/d48db5f9-eaef-4cce-9664-31c7540d1860/
```

No collisions, no skips, no rows pointing at a missing object.

### 4.1 The 64 rows going to `unassigned/`

64 of the 88 rows have `organization_id = NULL`, and three of the four
`developer_id` values (`8fd69d30…`, `fa42d1e2…`, `d48db5f9…`) do not exist in
`developers`, `memberships` or `admin_users` at all. There is no organization to
key them by, so they go under the `unassigned/` sentinel the upload route already
uses, which makes them service-role-only under `040`.

**This is not a regression.** Those rows are *already* invisible to every
authenticated caller: the table policy from `014`/`040` opens with
`organization_id = public.auth_org()`, and `NULL` never equals anything. No screen
in the product can reach them today. What changes is that they stop being
reachable by strangers holding a URL. (`040`'s own VERIFY query 6 counts exactly
this population.)

### 4.2 The 103 orphaned objects

The bucket holds 193 objects but only 88 have a row. The remaining 103 — all under
`zohaib6511/` — are employee screen captures with no database row.

The migration script is row-driven and deliberately will **not** move them: there
is no organization or developer id to key them by, and guessing one would file
somebody's screen under somebody else's name.

They need nothing from the script. No row points at them, so nothing in the
product renders them, so **step 5 below closes them on its own**. They are counted
here so the number is on the record before that flag is flipped. If the owner
wants them retained and viewable, that is a separate, manual attribution exercise;
if the owner wants them gone, deleting them after the flip breaks nothing.

---

## 5. Runbook — the exact order

The ordering trap: **flipping the bucket private before the objects have moved
turns every existing screenshot into a broken image** across Developer Activity,
the admin review panel and the session pages. Do not reorder these.

> Steps 1–3 are already done in branch `feature/landing-redesign` and only need
> deploying. Steps 4 onward are the owner's.

**1. Confirm the app can sign before anything moves.** ✅ done in this branch
`src/utils/screenshotFiles.js` classifies by shape and signs `monitoring` objects.
`npm test` → `tests/screenshotPaths.test.js` green.

**2. Confirm new uploads already land in the private bucket.** ✅ already true
`src/app/api/upload-screenshot/route.js` writes to `monitoring` at
`{org}/{developer}/{ts}-{uuid}.png`. Verify after deploy by taking one capture
through the desktop agent and checking it appears in `monitoring`, not
`screenshots`. **Read section 7 first — this may not hold for your agents.**

**3. Deploy the app.** Signing must be live in production *before* step 5.
Non-negotiable: this is what prevents the outage.

**4. Move the objects.**
```bash
node scripts/migrate-screenshots.mjs --project=isaccqqjobuwfeaxlrwc            # dry run, re-read it
node scripts/migrate-screenshots.mjs --project=isaccqqjobuwfeaxlrwc --confirm-migrate
```
Each object is downloaded, uploaded to `monitoring`, **read back and length-checked
before its row is touched**, and only then is `storage_path` repointed and
`public_url` nulled. A manifest of every `(id, old path, old public_url, new path)`
is written to the project root before the first row changes — **keep it**, it is
the only record of the pre-migration values. Nothing is deleted.

**5. Verify, with human eyes, before touching the flag.**
```bash
node scripts/migrate-screenshots.mjs --project=isaccqqjobuwfeaxlrwc   # expect: to migrate 0
```
Then, signed in as a real user, load **Developer Activity**, the **admin review
panel**, and a **session detail page**, and confirm captures render. They are being
signed at this point, and the old public URLs are still live, so if signing is
broken you will see it here while rollback is still trivial.

Also confirm the access rule actually bites: as a plain `developer`, you should see
your own captures and **not** a colleague's.

**6. Flip `screenshots` to private.** ← *owner's call, and only now*

Dashboard → Storage → `screenshots` → uncheck Public. Or:
```sql
update storage.buckets set public = false where id = 'screenshots';
```
This is the moment the leak actually closes — steps 1–5 exist only so that it can
be done without an outage. It also closes the 103 orphans (§4.2).

**7. Re-check the same three screens.** They must still render, now purely from
signed URLs. If anything is blank, `update storage.buckets set public = true where
id = 'screenshots'` restores the previous behaviour instantly while you diagnose;
the objects have been copied, not moved, so nothing has been lost.

**8. Later, once you are confident:** delete the objects from `screenshots`, drop
the bucket, and remove `legacyPublicUrl()` and its callers from
`src/utils/screenshotFiles.js` (the function's own comment states these exact
conditions). Optionally correct the tracker query at the bottom of `019` and `040`
so the next person is not misled by `like 'screenshots/%'` again.

### Do not

- Do not flip the flag before step 4 completes and step 5 passes.
- Do not delete anything from `screenshots` until step 7 has passed.
- Do not "fix" a `PROJECT MISMATCH` abort by changing the flag until you are
  certain which database the ref belongs to.

---

## 6. The public `documents` bucket — what depends on it

**Not changed here, and it should not be changed without its own plan.** 73
objects, all at the bucket root, all project requirement documents
(`.docx` / `.pdf` / `.txt`). Also anonymously readable:

```
HTTP 200  11067 bytes  application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

This is a smaller problem than the screenshots — business documents rather than
employee surveillance — but it is the same class of problem, and the exposure is
real.

**What breaks if it is made private:**

1. **`projects.file_url`** — 2 live rows hold full public `documents` URLs. Four
   readers dereference them, and three do it without any signing layer:
   - `src/components/admin/AllProjects.jsx:603-608` — calls `resolveOrgFileUrl()`,
     which passes any `http…` value through **untouched** (`isLegacyFileUrl`), so
     it opens the public URL. Would 400.
   - `src/components/developer/MyProjects.jsx:117` — `window.open(file_url)`. Breaks.
   - `src/components/developer/ProjectDetails.jsx:202,464` — `window.open`. Breaks.
   - `src/app/developer/project-details/page.jsx:797-845` — `fetch(file_url)` for
     the download button, plus `window.open` fallback. Breaks.

   New project documents already go to the **private `org-files`** bucket via
   `uploadOrgFile()` (`AllProjects.jsx:363`), so this is a shrinking legacy tail:
   2 rows, both fixable by copying those two objects into `org-files` and storing
   the path instead of the URL. The other **71 objects have no row referencing
   them at all** — dead weight from deleted projects.

2. **Organization logos** — `src/components/admin/OrganizationSettings.jsx:217-219`
   uploads to `documents` under `org-logos/{orgId}/…` and stores
   `getPublicUrl()`. No organization currently has a logo set and there is no
   `org-logos/` folder in the bucket yet, but the **write path is live**: the next
   org that uploads a logo puts it in a public bucket.

   `src/utils/orgFiles.js` argues, deliberately, that logos *should* stay public —
   they are branding, they are embedded in outbound email, and a signed URL
   expires and breaks there. That argument is sound. It means `documents` cannot
   simply be flipped private; the project documents need to move to `org-files`
   first, and the logos need somewhere public to live.

**Recommendation:** treat this as a separate piece of work. Move the 2 referenced
project documents to `org-files`, audit the 71 unreferenced ones, give logos their
own small public `public-assets` bucket, then flip `documents` private. Do not
bundle it with the screenshot migration — different consumers, different failure
mode, and the screenshot fix should not wait on it.

---

## 7. Does the desktop agent write storage directly?

**Yes — the evidence says the agent uploads to storage itself and inserts its own
row, bypassing `/api/upload-screenshot` entirely.** The agent's source is outside
this repository so this cannot be read directly, but the data is unambiguous.

`docs/desktop-ingest-auth.md` documents the agent as POSTing to
`/api/upload-screenshot`. Nothing in the live data is consistent with that route
having written it:

| evidence | what the route does | what the data shows |
| --- | --- | --- |
| key shape | `{org_uuid}/{dev_uuid}/{ms}-{uuid}.png`, and per its own header the *older* version wrote `screenshots/{developer_id}/{ms}.png` | `{email_local_part}/screenshot_{YYYYMMDD}_{HHMMSS}_{ms}_{hex8}.jpg` — neither shape, and no version in this repo's history produces it |
| extension | `.png`, `contentType: 'image/png'` | `.jpg`, `image/jpeg` |
| `public_url` | left **null** — "readers sign `storage_path` on demand" | populated on **all 88** rows with a `/object/public/screenshots/…` URL, i.e. the writer called `getPublicUrl()` after uploading |
| `organization_id` | always derived from the `developers` row | **NULL on 64 of 88** |
| developer identity | rejects an unknown developer with 403 | 3 of the 4 `developer_id`s exist in **no** table |
| folder naming | only ever has `developer.id` in hand | folder is the **email local part** — something only a program that knows the signed-in user's address would use |

Two further tells: the bucket contains a `.emptyFolderPlaceholder`, which is what
a Supabase **client** SDK creates when it makes a folder — not something a server
route doing one upload produces. And the filenames come in two generations
(`screenshot_20260417_193755.jpg`, then
`screenshot_20260423_232359_536_d4aae287.jpg`), which is a client program that
shipped an update; this repo's history contains neither.

### What this means for the owner

**Fixing the app alone does not close this.** Steps 1–6 will move and protect
everything that exists today, but if the agent keeps uploading directly then new
captures keep landing in the public bucket and the leak reopens the moment
someone starts tracking.

Consequences to plan for:

1. **Step 6 will break the agent's uploads.** Once `screenshots` is private, the
   agent's `upload()` and its `getPublicUrl()` stop working. Depending on how it
   handles errors, it may fail silently and stop capturing, or it may error
   visibly. **Confirm this before the flip, not after.**
2. **The agent must be updated** to POST to `/api/upload-screenshot` — which
   already writes to `monitoring` with the correct key — rather than touching
   storage. `docs/desktop-ingest-auth.md` already specifies the contract, and the
   `DESKTOP_INGEST_SECRET` / `DESKTOP_INGEST_ENFORCE` staging exists precisely to
   roll this out without stopping tracking for installed agents.
3. **Separately worth checking:** if the agent inserts `screenshots` rows itself,
   it is doing so with credentials that permit an insert into that table. Whatever
   key it holds and whatever policy allows that write is outside this migration's
   scope, but it is on the same thread and should be audited. The 64 NULL
   `organization_id` rows and the 3 non-existent `developer_id`s are what
   unvalidated client-side inserts look like.

**Recommended sequence:** confirm what the agent does (read its source or watch
one machine's traffic) → update it to use the route → confirm new captures appear
in `monitoring` → then run steps 4–6. If updating the agent has a long tail, steps
4–6 are still worth doing now: they protect the 193 objects that exist, and any
new object landing in a private bucket is a smaller problem than 193 in a public
one.

---

## Appendix — verification commands

```bash
# bucket public flags
curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  "$URL/storage/v1/bucket" | python3 -m json.tool

# how many rows still point outside `monitoring` (expect 88 now, 0 after step 4)
node scripts/migrate-screenshots.mjs --project=<ref>

# prove the leak is closed after step 6 — expect 400, not 200
curl -s -o /dev/null -w '%{http_code}\n' \
  "$URL/storage/v1/object/public/screenshots/zohaibawan6511/screenshot_20260705_105605_570_aaf3ae68.jpg"
```

```sql
-- 019 and 040 both ship this tracker. It is WRONG — it looks for a `screenshots/`
-- prefix that has never existed in this project's data, and returns 0 whatever
-- the truth is. Use this instead:
select count(*) as still_public
  from public.screenshots
 where storage_path is null
    or not (storage_path ~ '^([0-9a-f-]{36}|unassigned)/[0-9a-f-]{36}/');
```
