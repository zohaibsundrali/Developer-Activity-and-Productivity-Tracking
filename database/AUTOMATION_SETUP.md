# Workflow Automation — setup

Phase E adds two kinds of automation. Event rules work with no configuration.
The **scheduled** jobs need one environment variable.

---

## 1. Event rules (no setup needed)

Configured in **Admin → Automation**. Stored in `automation_rules` (migration 016).

They run client-side, immediately after a task mutation, under the signed-in
user's JWT — so every write an automation performs is still RLS-scoped. An
automation can never touch data its author couldn't touch by hand.

| Trigger | Fires when |
|---|---|
| `task_created` | a task is created via the board / views / backlog |
| `status_changed` | a task moves column (drag-drop or status edit) |
| `assigned` | a task's assignee is set |
| `priority_changed` | priority is changed |

| Action | Effect |
|---|---|
| `assign` | set the assignee |
| `set_status` | move to a status |
| `set_priority` | set priority |
| `add_label` | append a label |
| `notify` | insert an in-app notification |
| `email` | notification **+** email via `/api/automation/notify` |

Loop safety: actions write with a plain update (never through `moveTask`), so a
rule cannot re-trigger rules. Failures are swallowed — a broken automation can
never break the user's actual task edit.

---

## 2. Scheduled jobs — **requires `CRON_SECRET`**

`/api/cron` runs daily and does two things:

1. **Due-date reminders** — notifies assignees of tasks due today/tomorrow and
   anything overdue. De-duplicated: at most one reminder per task per day.
2. **Recurring tasks** — spawns the next occurrence of tasks flagged
   `is_recurring` whose next date has arrived, then advances the template's
   `recurrence.last_spawned` cursor so it cannot double-spawn.

### Required env var

```
CRON_SECRET=<a long random string>
```

Generate one with:

```bash
openssl rand -hex 32
```

Add it in **Vercel → Project → Settings → Environment Variables** (and to
`.env.local` for local testing).

> **The route fails closed.** If `CRON_SECRET` is unset, `/api/cron` returns
> `401` and does nothing. That is deliberate — an unauthenticated endpoint that
> writes notifications and creates tasks would be an open hole. Nothing else in
> the app breaks; only the scheduled jobs stay idle until the secret is set.

### Schedule

`vercel.json` already declares it — daily at 06:00 UTC:

```json
{ "crons": [{ "path": "/api/cron", "schedule": "0 6 * * *" }] }
```

Vercel automatically sends `Authorization: Bearer $CRON_SECRET`, which is
exactly what the route checks.

> Vercel's Hobby plan allows cron jobs once per day. On Pro you can tighten the
> schedule (e.g. `0 */6 * * *`).

### Manual test

```bash
curl -X POST https://<your-domain>/api/cron \
  -H "Authorization: Bearer $CRON_SECRET"
```

Returns a summary:

```json
{ "ok": true, "ranAt": "...", "remindersSent": 3, "recurringSpawned": 1, "errors": [] }
```

---

## 3. Email

Emails reuse the existing Gmail transport (`GMAIL_EMAIL` / `GMAIL_APP_PASSWORD`
in `src/utils/mailer.js`). If those are unset, notifications are still created
in-app and the response reports `emailSkipped` — nothing errors.

`/api/automation/notify` is authenticated and re-checks every recipient against
`memberships` for the caller's organization before sending, so it cannot be used
as an open relay.
