# Secrets and Environment

Audit date: 2026-08-08 (Phase 16). Applies to branch `feature/production-completion`.

This document is the authoritative inventory of every environment variable the
web app reads, which of them are secret, and how to rotate each one.

Template: [`.env.example`](../.env.example). Copy it to `.env.local` and fill in
real values. `.env.local` is git-ignored and must never be committed.

---

## 1. Inventory

`Set?` reflects what is present in the local `.env.local` at audit time. Values
were never read or printed — only key names were enumerated.

### Server-only secrets

| Variable | Read at | Required | Missing behaviour | Set? |
|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `src/utils/serverAuth.js:12`, `src/utils/sessionCookie.js:31`, and 12 `/api` routes | **Yes** | Newer routes return HTTP 500 `Server misconfigured`; older routes silently fall back to the anon key and then fail on RLS | Yes |
| `SESSION_COOKIE_SECRET` | `src/utils/sessionCookie.js:30` | **Yes in prod** | Falls back to `SUPABASE_SERVICE_ROLE_KEY` as HMAC material. If both are absent, `hmac()` returns null and every session fails to sign/verify (fail-closed) | **No** |
| `DESKTOP_INGEST_SECRET` | `src/app/api/track-activity/route.js:46`, `src/app/api/upload-screenshot/route.js:46` | **Yes in prod** | **Fails OPEN** — `if (!secret) return true`. Both ingest endpoints accept unauthenticated writes | **No** |
| `CRON_SECRET` | `src/app/api/cron/route.js:50` | For cron | Fails closed; scheduled jobs never run | **No** |
| `STRIPE_SECRET_KEY` | `src/utils/stripeServer.js:19,33,43` | Optional | `billingConfigured()` false; billing endpoints refuse cleanly | **No** |
| `STRIPE_WEBHOOK_SECRET` | `src/utils/stripeServer.js:79` | Optional | Webhook signature verification unavailable | **No** |
| `GMAIL_APP_PASSWORD` | `src/utils/mailer.js:9,23`, `src/app/api/invitations/route.js:161`, `src/app/api/send-verification/route.js:92` | Optional | `mailer.js` reports not-configured; email is skipped **silently** | Yes |
| `HUGGINGFACE_API_KEY` | `src/app/api/ai-generate-tasks/route.js:13` | Optional | AI task generation unavailable | Yes |

### Server-only, non-secret

| Variable | Read at | Required | Missing behaviour | Set? |
|---|---|---|---|---|
| `GMAIL_EMAIL` | `src/utils/mailer.js:9,23,26,27`, `src/app/api/invitations/route.js:160,170`, `src/app/api/send-verification/route.js:91,121` | Optional | Email disabled silently | Yes |
| `BILLING_GRACE_PERIOD_DAYS` | `src/utils/stripeServer.js:120` | Optional | Defaults to 3 days | No |
| `NODE_ENV` | 4 sites | Framework-provided | Set by Next.js; do not define manually | n/a |

### Public by design (`NEXT_PUBLIC_*` — inlined into the client bundle)

Everything below is compiled into the JavaScript served to browsers. Treat all
of it as world-readable.

| Variable | Read at | Required | Missing behaviour | Set? |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 18 sites incl. `src/utils/serverAuth.js:10` | **Yes** | Supabase client cannot initialise; API routes 500 | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 13 sites incl. `src/utils/serverAuth.js:11` | **Yes** | Browser auth fails entirely | Yes |
| `NEXT_PUBLIC_EMAILJS_SERVICE_ID` | 4 sites | Optional | EmailJS send disabled | Yes |
| `NEXT_PUBLIC_EMAILJS_TEMPLATE_ID` | 4 sites | Optional | EmailJS send disabled | Yes |
| `NEXT_PUBLIC_EMAILJS_PUBLIC_KEY` | 6 sites | Optional | EmailJS send disabled | Yes |
| `NEXT_PUBLIC_APP_URL` | `src/utils/stripeServer.js:56`, `src/app/api/notify/client/route.js:85` | Recommended | Falls back to request origin — a spoofed `Host` could influence Checkout return URLs | No |
| `NEXT_PUBLIC_SITE_URL` | `src/app/api/notify/client/route.js:85` | Optional | Falls back to `NEXT_PUBLIC_APP_URL`, then `""` | No |
| `NEXT_PUBLIC_ERROR_REPORT_URL` | `src/utils/logger.js:24` | Optional | Client error reporting disabled | No |

### Local QA scripts only

Never set these in a production environment.

| Variable | Read at | Notes |
|---|---|---|
| `BASE` | `scripts/saas-qa.cjs:4`, `scripts/login-test.cjs:4` | Defaults to `http://localhost:3200` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `scripts/qa_isolation_probe.mjs:156,160,161` | Throwaway QA accounts only |
| `CLIENT_EMAIL` / `CLIENT_PASSWORD` | `scripts/qa_isolation_probe.mjs:98,99` | Throwaway QA accounts only |

---

## 2. What is public by design

Two things commonly mistaken for leaks are intentional:

- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** is a JWT that ships in the client bundle
  on purpose. It is safe *only* because Row Level Security constrains what it
  can reach. It is not a secret, and it is not a substitute for the
  service-role key. If RLS is disabled or bypassed, this key becomes a full
  read/write handle to your data.
- **`NEXT_PUBLIC_EMAILJS_PUBLIC_KEY`** is designed for browser use and is
  rate-limited per domain by EmailJS.

Everything else without the `NEXT_PUBLIC_` prefix is server-only.

**Verified at audit time:** all 14 files that read `SUPABASE_SERVICE_ROLE_KEY`
are API routes or server utilities, and none carries a `"use client"`
directive. No client component references `SUPABASE_SERVICE_ROLE_KEY`,
`GMAIL_APP_PASSWORD`, `HUGGINGFACE_API_KEY`, `STRIPE_SECRET_KEY`, or
`STRIPE_WEBHOOK_SECRET`. Re-run that check before every release:

```bash
git grep -l '"use client"' -- 'src/*' | xargs grep -lE 'SERVICE_ROLE|SECRET_KEY|APP_PASSWORD'
```

Any output from that command is a shipped-secret incident.

---

## 3. Coupled secrets — read before rotating

`src/utils/sessionCookie.js:30-33` signs the `dt_session` auth cookie with:

```
SESSION_COOKIE_SECRET || SUPABASE_SERVICE_ROLE_KEY || ""
```

`SESSION_COOKIE_SECRET` is **not currently set**, so the session cookie is
today signed with the service-role key. Two consequences:

1. Anyone holding the service-role key can **forge a valid session cookie for
   any organization and role**, not merely query the database.
2. Rotating the service-role key **invalidates every active session** and logs
   all users out.

Set `SESSION_COOKIE_SECRET` to an independent random value *before* rotating
the service-role key. That decouples the two and turns the rotation into a
non-event for logged-in users.

---

## 4. Rotation procedures

### `SUPABASE_SERVICE_ROLE_KEY`
1. Set an independent `SESSION_COOKIE_SECRET` first (see §3) and deploy.
2. Supabase Dashboard → Project Settings → API → roll the `service_role` key.
   Requires project **owner** access.
3. Update the value in every deployment target (Vercel project env vars, CI
   secrets, the desktop agent's build config, local `.env.local`).
4. Redeploy. Old key stops working immediately on roll — deploy promptly.

### `NEXT_PUBLIC_SUPABASE_ANON_KEY`
Rolled from the same Supabase API settings page. Because it is embedded at
build time, a rotation requires a **rebuild and redeploy**, not just an env
change. Cached bundles carry the old key until they expire.

### `SESSION_COOKIE_SECRET`
`openssl rand -base64 48`. Rotating it logs everyone out by design. No external
provider involved — change the env var and redeploy.

### `DESKTOP_INGEST_SECRET`
`openssl rand -hex 32`. Must be rotated in the web app **and** the desktop
tracker simultaneously, or agents stop reporting. Note this gate fails open, so
an unset value is worse than a stale one.

### `CRON_SECRET`
`openssl rand -hex 32`. Update in the env and in whatever scheduler calls
`/api/cron` (e.g. `vercel.json` cron config or the external caller).

### `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
Stripe Dashboard → Developers → API keys → roll. Stripe supports overlapping
keys: create the new one, deploy, then revoke the old. The webhook secret is
per-endpoint under Developers → Webhooks and changes if the endpoint is
recreated.

### `GMAIL_APP_PASSWORD`
Google Account → Security → App passwords. Revoke the old entry and generate a
new one. This is an App Password, never the account password.

### `HUGGINGFACE_API_KEY`
HuggingFace → Settings → Access Tokens → revoke and re-create.

### GitHub Personal Access Token (not an app env var)
Stored in `.git/config` as part of `remote.origin.url`. See §5.

---

## 5. If a key leaks, do this

Work in this order. Revoking is always step one — scrubbing the artifact is
housekeeping and does nothing to close the exposure.

1. **Revoke or roll the credential at the provider.** Until this happens,
   nothing else you do reduces risk. A key removed from a file but still valid
   is still leaked.
2. **Deploy the replacement** to every environment that needs it.
3. **Check the provider's audit log** for use you did not authorise — Supabase
   logs, Stripe events, GitHub security log, Google account activity.
4. **Only then** clean the artifact (git history, config file, log). Note that
   rewriting git history does not un-leak anything already cloned or already
   scraped; treat any secret that reached a remote as permanently compromised.
5. **Record it** so the rotation does not get lost between sessions.

### Credential-in-git-remote-URL specifics

A token embedded in `remote.origin.url` lives in `.git/config`, which is **not
tracked by git** — it never leaves via a push, and it is not in any commit. The
exposure is instead local: anyone who can read that file on the machine, any
backup or disk image, and any process running as another user if file
permissions are loose. Fix by rolling the token, then re-pointing the remote at
a clean URL and using a credential helper or SSH instead of an inline token.

---

## 6. `.gitignore` coverage

Verified ignored: `.env*` (line 34), `/.next/` (line 17), `/node_modules`
(line 4), `*.pem` (line 25), `/coverage`, `.vercel`.

Added during this audit:
- `!.env.example` — the `.env*` rule was swallowing the template, so no
  committable template could exist.
- `*.key`, `*.p12`, `*.pfx`, `*.crt`, `id_rsa*`, `id_ed25519*`,
  `*credentials*.json`, `service-account*.json`, `secrets.json`.
