# Signals — the part of the product that notices

**Status:** built, tested, building. No migration required. Nightly delivery needs `CRON_SECRET`.

---

## 1. What it is for

Every other screen in this product reports. None of them notices.

A team lead does not want a chart of last week. They want to be told that
someone's active hours halved, that a sprint is going to miss, that a
submission has been waiting four days for a review nobody is doing. The data
and the notification system to deliver it were both already here; what was
missing was anything that looked at the numbers and formed an opinion.

Signals is that. It runs on demand for a dashboard panel, and once a night for
the notification centre.

---

## 2. The detectors

All seven live in `src/utils/signals.js`.

| Signal | Fires when | Severity |
| --- | --- | --- |
| `activity_drop` | Someone's tracked time falls below half their **own** recent average | warning, critical below a quarter |
| `tracking_silent` | Someone who was tracking regularly has sent nothing for 3+ days | warning, critical at 9+ |
| `review_backlog` | Submissions unreviewed for 3+ days | warning, critical at 7+ |
| `tasks_stalled` | Assigned tasks with no update for 7+ days | info |
| `overdue_pileup` | 3+ overdue open tasks on one project | warning, critical at 10+ |
| `sprint_at_risk` | Active sprint ends within 3 days with >30% still open | warning, critical at 1 day |
| `plan_pressure` | A plan meter at 80% or more | warning, critical at 95% |

Every threshold is in one exported `DEFAULTS` object, so tuning a noisy
deployment is one change rather than seven.

---

## 3. Three rules that keep it honest

A signal interrupts somebody. These are the rules that decide whether one is
worth raising, and they are the reason the code looks the way it does.

**Compare a person to themselves, never to each other.** There is no league
table and no cross-person comparison anywhere in this file. That is partly
ethics and mostly accuracy: a senior engineer in code review and a junior
writing boilerplate produce incomparable numbers, and a product that ranks them
is measuring the wrong thing while making itself hated. `detectActivityDrop`
computes each person's own trailing four-week average and compares this week to
that.

**Require a baseline worth comparing against.** Someone who tracked 40 minutes
last month has no trend. "Activity down 100%" about a rounding error is the
noise that teaches people to ignore everything else, so anyone below five hours
a week of baseline is skipped entirely. A brand-new joiner raises nothing.

**Say what would clear it.** Every message ends in something a person can do. A
signal that names no action is an anxiety generator. The activity-drop message
explicitly lists the likelier explanations — leave, illness, a week of meetings,
a stopped tracker — because the one people jump to is usually the wrong one.

### What this is not

Not a productivity score, not a ranking, not an input to anybody's review. It
reports **change** and **blockage**. A drop in tracked activity is a prompt to
ask a question, not an answer to one.

---

## 4. Design decisions worth knowing

**Every detector is pure.** They take plain arrays and a `now`, and return
signal objects — no database client, no clock of their own, no I/O. A rule that
says "this person's work has dropped by half" is a claim about a human being,
and it has to be testable to the day rather than by waiting five weeks for data
to accumulate. `tests/signals.test.js` exercises 43 cases, weighted towards
everything that must *not* fire.

**No new table, no migration.** A signal is a statement about the current state
of other rows. Persisting it would create a second source of truth that goes
stale the moment a review is done. The panel computes them per request; the
nightly job writes the important ones into `notifications`, which is a record of
*"we told you"*, not of *"this is true"*.

**`info` is never pushed.** "Nine tasks have not moved in a week" belongs on the
panel where somebody goes looking. Sending it every night is how the feature
gets muted in a fortnight — and a muted signal is worse than none, because
everybody still believes it works.

**One query set, used twice.** `/api/cron` imports `collect()` from
`/api/signals` rather than writing its own fetches. Two copies of "what the
detectors need" would drift, and the first symptom would be the nightly
notification disagreeing with the panel it links to.

**Dedupe carries the calendar day.** Each signal's `dedupeKey` includes the date
and the recipient, and `notifications` has a unique index on `dedupe_key`
(migration 029). A cron that fires twice because a deploy overlapped collides
instead of duplicating — which is why the insert goes one row at a time and
treats `23505` as success. A batch insert would lose every row in the batch to
one collision.

---

## 5. Who sees what

These are statements about named people's working patterns, so visibility
follows the monitoring surface rather than being open to anyone with a login.

| Role | Sees |
| --- | --- |
| owner, admin | everything, including plan pressure |
| hr | everything about people; not billing |
| manager | **only their own direct reports**, plus team-level signals |
| everyone else | 403 |

The manager rule reads `memberships.reports_to` — the same hierarchy the rest of
the product uses. Note that it is **unset for everyone today**, so a manager
currently sees no person-level signals at all. That is the honest behaviour of
an empty hierarchy, not a bug to route around by widening the rule.

Both `/api/signals` and cron job 4 enforce this independently, because they are
separate code paths reaching the same data.

---

## 6. Where it appears

**The dashboard panel** — `SignalsPanel`, mounted at the top of the admin
overview, above the counters. Everything below that line reports a number; this
reads the numbers and says what needs doing, so putting it under three rows of
stat cards would bury the only thing on the page that asks for an action.

It renders nothing at all for a role that cannot see signals — an empty panel
would imply the workspace is quiet. There is no dismiss button: a signal clears
when the condition clears, and "mark as read" would let somebody silence a
sprint that is still going to miss.

The empty state is the **good** state, and is written to feel deliberate rather
than like a panel that failed to load.

**The notification centre** — signals get their own category (`signal`,
"Needs attention") rather than falling through to `general`. That matters twice:
they can be filtered on their own, and the preference row keyed on that category
is the switch that turns the feature off for someone who does not want it.
Landing in `general` would have made both impossible while appearing to work.

Clicking one goes to the project for a project signal, the sprint board for a
sprint signal, and the overview otherwise.

---

## 7. Verification

- `tests/signals.test.js` — 43 tests. The detectors, every false-positive case,
  determinism, and the route's authorization shape.
- `tests/notificationCenter.test.js` — the category and link seam.
- Every query in `collect()` was run against the **live** Supabase schema before
  this shipped. That check found `projects.project_name`, which does not exist
  — the column is `projects.name`. PostgREST rejects the whole select for one
  unknown column, so the only symptom would have been a permanently empty panel
  reporting `degraded: true`.

## 8. To switch the nightly run on

Set `CRON_SECRET` on Vercel and point Vercel Cron at `/api/cron` daily. The
route refuses to run without it. The same schedule also drives due-date
reminders, recurring tasks and trial reminders.
