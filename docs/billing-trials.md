# Plans, trials and the lock

**Status:** code complete and building. **`database/053_billing_plans_and_trials.sql` has not been run yet** — until it is, the plan catalogue is empty and every organization behaves exactly as it did before. Nothing breaks in the meantime; the flow simply falls back to Free.

---

## 1. What was there before

Migration 027 built the entire billing schema and included a seed for four plans. The tables exist on the live project. The seed never landed. Measured on 2026-08-10:

```
billing_plans               0 rows
organization_subscriptions  0 rows
organizations               1 row
```

So there was no catalogue to choose from, no organization had a subscription, signup never created one, and `resolveEntitlement` fell all the way through to the hardcoded `FALLBACK_FREE_LIMITS` in `src/utils/entitlements.js`. The admin Billing screen rendered an empty plan grid. Billing had been built and never switched on.

---

## 2. What the flow does now

```
   register ──▶ verify email ──▶ CHOOSE PLAN ──▶ CARD (paid only) ──▶ workspace
                                      │
                            Free ─────┘  (no card, no trial, no expiry)

   paid plan ──▶ 7-day trial ──▶ daily reminder to owner/admin
                                      │
                        trial ends ───┴──▶ LOCKED ──▶ /admin/upgrade ──▶ dashboard
```

**The account is created at the END.** Verifying the code no longer registers anything: `verifyCodeAndContinue` advances to the plan step and `completeRegistration` runs after the card step. Creating the organization first and collecting billing afterwards would leave a real, half-configured tenant behind every abandoned checkout.

### The catalogue (seeded by 053)

| Plan | Price | Trial | Notes |
| --- | --- | --- | --- |
| Free | $0 | **none** | Free is a destination, not a countdown. Never locks. |
| Professional | $49/mo | **7 days** | |
| Business | $149/mo | **7 days** | |
| Enterprise | $499/mo | none | Sold, not self-served. |

027 seeded 14-day trials; the product decision is 7. `trial_days` is read from the row at signup, never from a constant, so changing it later is one `UPDATE` and not a deploy.

`api_access` is now **false on every plan**. 027 had it true on Business and Enterprise. There is no API. A green tick beside a feature that does not exist is a claim made to someone about to spend $149 a month, and `hasFeature` reads a missing or false flag as not granted — so false is both honest and the fail-closed direction.

---

## 3. `entitled` and `locked` are different questions

This is the distinction the whole feature rests on.

| | question | when a paid plan lapses |
| --- | --- | --- |
| `entitled` (`entitlements.js`) | how much may they do? | falls back to **Free limits** |
| `locked` (`billingAccess.js`) | may they do anything at all? | **workspace closes** |

**What locks**

- a paid plan whose 7-day trial ended with no payment
- `past_due` once the grace period has *also* elapsed
- `unpaid` — the card failed every retry

**What deliberately does not**

- the **Free plan**, under any status
- an organization with **no subscription row** — fails open; a lock must never be reachable by a row simply being absent
- a **deliberately cancelled** plan. `/api/billing/cancel` promises on screen that the plan "reverts to Free". Locking would break that promise and punish the honest exit.
- a trialing row with a **null `trial_end`** — that is an open-ended grant, which is how PART 3 of 053 holds the owner's own organization on Enterprise permanently

### Where it is enforced — and where it is not

An adversarial review of the first version of this feature found that the lock
barely enforced anything, and an earlier draft of this document overstated it.
The honest picture:

**Enforced server-side**

| What | Where |
| --- | --- |
| Inviting a member, accepting an invite, provisioning a login | via `checkSeatLimitForRole` / `checkFeatureAccess` |
| Automation email actions | via `checkFeatureAccess('automation')` |
| Submitting work, submitting a plan, reviewing a submission, AI task generation | via `requireUnlocked` — added because these routes have no plan **meter**, so neither of the checks above ever ran on them |

The check sits **before** the unlimited short-circuit in `checkResourceLimit`. `active_tasks` is `-1` on Business, and the function returns early for an unlimited limit — a lock placed after that line would never fire for the most expensive plans. There is a test for exactly this.

**NOT enforced, and this is the real gap**

A large amount of this product writes to Supabase **directly from the browser** — `src/utils/pmData.js` creates projects, tasks, sprints, epics, checklists and milestones with the user's own JWT. There is no server route to put a check in. Closing that needs an **RLS predicate** on those tables, which is a migration and a deliberate decision, not something to slip into a UI change. Screenshot upload and the client-portal comment/approval routes are also currently ungated.

So today a determined member of a locked organization who bypasses the UI can still create work. What they cannot do is reach any of it through the product: `BillingGate` is mounted on **all three** areas — `/admin`, `/developer` and `/client`. It was initially only on `/admin`, which meant a locked admin could simply navigate to `/developer/dashboard` and carry on, as could every developer, who was never redirected at all.

`BillingGate.jsx` is a navigation gate, not a data gate. Deleting it would cost the redirect and change nothing about the server-side refusals above.

---

## 4. Card handling — read this before changing it

**No card number, expiry or CVC leaves the browser.** The form validates locally; the signup request carries `paymentMethodProvided: true` and nothing else. Nothing is POSTed, logged, or stored.

While `STRIPE_SECRET_KEY` is unset, **only Stripe's published test numbers are accepted** (`4242 4242 4242 4242` and friends). That is the point, not a limitation:

- a form that accepts a real card while taking no payment teaches someone they have paid when they have not — and the first they hear otherwise is when their workspace locks;
- a real PAN typed into a page that is not PCI-scoped is a problem the moment it exists, regardless of whether this code transmits it. Browser autofill, extensions and screen recording all see the field.

`/api/billing/demo-activate` **turns itself off**: the only condition under which it does anything is `billingConfigured() === false`. Add a real Stripe key and it answers 404, leaving Checkout as the only way to pay. That is deliberately not an env flag of its own — a flag someone has to remember to unset is a flag that stays set.

Every demo activation writes `last_payment_status = 'demo_paid'` (a string no real payment path writes) and a `billing.demo_activated` system event, so "who got a paid plan without paying" is answerable later.

---

## 5. The daily reminder

Job 3 in `/api/cron`. For each organization on a running paid trial, one notification per day to **owner and admin only** — a developer cannot enter a card, and telling twenty engineers their employer's trial expires on Friday is noise for nineteen of them.

Deduped by reading the day's existing `trial_reminder` rows once for the whole batch, so a cron that runs twice because a deploy overlapped does not send the warning twice.

Requires `CRON_SECRET` to be set — the route refuses without it. **This is still outstanding on Vercel.**

---

## 6. The middleware was never running

Found while testing this feature, and unrelated to it.

`middleware.ts` sat at the repository root. Next resolves middleware next to the app directory, and this project keeps its app under `src/` — so `src/middleware.ts` is the path that gets compiled and a root-level file is silently ignored. No warning, no error. The proof:

```
$ cat .next/server/middleware-manifest.json
{ "sortedMiddleware": [], "middleware": {}, "functions": {}, "version": 2 }
```

Measured against **production** before the fix — anonymous requests:

| path | before | after |
| --- | --- | --- |
| `/admin/dashboard` | **200** | 307 → `/login?redirect=…` |
| `/developer/dashboard` | **200** | 307 → `/login?redirect=…` |
| `/client` | **200** | 307 → `/login?redirect=…` |
| `/admin/registration` | 200 | **200** — must stay public |

**What it did not cost:** those pages are client-rendered and fetch with a bearer token, so the anonymous HTML contained no tenant data, and `/api/productivity` still answered 401. The API guard and RLS were doing the real work the whole time — which is exactly why nobody noticed.

**What it did cost:** the navigation gate the file describes did not exist. The product was one layer of defence short of what it claimed.

**The trap in fixing it:** `/admin/registration` starts with `/admin`. Switching the middleware on without exempting it turns signup into an immediate redirect to `/login` — it takes the product off sale. Hence `PUBLIC_PATHS`, tested for both existence and ordering.

`SESSION_COOKIE_SECRET` is still unset on Vercel, but `secretMaterial()` falls back to `SUPABASE_SERVICE_ROLE_KEY`, which is present — so turning the gate on does not lock anyone out. Setting the dedicated secret is still worth doing, and must be done at the same time as rotating the service-role key or every live session is invalidated.

`tests/middlewareGate.test.js` now checks the manifest is non-empty after a build. That is the only assertion that would have caught the original bug — reviewing the rules would have proved nothing, because they were already correct.

---

## 7. What you have to do

1. **Run `database/053_billing_plans_and_trials.sql`** — PART 1, PART 2, PART 3, each on its own. It was validated on `postgres:16-alpine` against a fixture including a second organization with a pre-existing subscription, which it correctly left untouched, and it was run twice to prove it converges.
2. **Set `CRON_SECRET` on Vercel** and point Vercel Cron at `/api/cron` daily, or the trial reminders never fire.
3. Optionally set `SESSION_COOKIE_SECRET` (see above).

After PART 3 your own organization (`Alfcode`) is on **Enterprise, permanently** — no trial, no countdown, and the gate cannot touch it. Building the product from inside a locked-out account is not a position worth being in.

---

## 8. What the review caught

The feature was reviewed adversarially before it shipped. Nine real defects came
back; all were fixed. The three worth knowing about:

**Signup could never reach the dashboard.** The registration page never signed
the browser in — the account is created server-side by
`admin.auth.admin.createUser`, which creates no session in the tab — so
`authFetch("/api/auth/session")` had no token, answered 401 inside an empty
`catch`, and wrote no cookie. Harmless while the middleware was not running.
The moment it started running, every new signup was told "Workspace created"
and then bounced to `/login`. Registration now does the same two steps `/login`
does: `signInWithPassword`, then the session call — and reports the failure
instead of swallowing it.

**A free 7-day Enterprise trial.** `053` marks Enterprise `trial_days = 0`
meaning "sold, not self-served", but `trialEndFor` treated `0` as a nonsensical
value and fell back to the 7-day default. Clicking the Enterprise card — or
POSTing `{"planCode":"enterprise"}` — minted a 7-day trial of the unlimited plan
with every feature on and no payment. `resolvePlanForSignup` now refuses any
paid plan with no self-serve trial and falls back to Free.

**The trial reminder went to a column nobody reads.** Job 3 wrote
`developer_id`, copied from job 1 — but its recipients are owners and admins,
whose `memberships.user_id` is an `admin_users.id`. That fails the foreign key
to `developers(id)`, taking the whole batch down while the cron still answered
200; and even if it inserted, the admin bell queries `admin_id` / `admin_email`,
so it would have been invisible for ever. Now written the way
`notifications.notify()` already does it.

The others: a stale-closure bug that made `paymentMethodProvided` always false;
card validation that accepted any 13–19 digits once Stripe was configured, on a
screen with no Checkout handoff; `demo-activate` reporting success for an
`update` that matched no row; the gate rendering a full dashboard before its
first answer arrived; and signup reporting a trial that may not have been
created.

## 9. Tests

- `tests/billingAccess.test.js` — 24 assertions, weighted towards everything that must **not** lock
- `tests/entitlements.test.js` — the lock as enforced by the limit checks, including the unlimited-plan case
- `tests/middlewareGate.test.js` — delivery, not logic
- `tests/termsAcceptance.test.js` — signup's insert order, now including `organization_subscriptions`
- `tests/registrationVerification.test.js` — the OTP step now advances instead of registering
