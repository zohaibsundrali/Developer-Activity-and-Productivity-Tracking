# Desktop agent ingest authentication

Contract and rollout plan for authenticating the desktop tracker against the
two ingest endpoints:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/track-activity` | activity batches |
| `POST /api/upload-screenshot` | screenshot uploads |

Audience: whoever maintains the **desktop tracker** (a separate program, outside
this repository) and whoever owns the production environment variables.

---

## Why this exists

Both endpoints used to accept **unauthenticated writes** whenever
`DESKTOP_INGEST_SECRET` was unset — which is the case in production today:

```js
if (!secret) return true;  // enforcement not enabled yet
```

Anyone who knew a developer's UUID could post activity rows and screenshots into
that person's timeline. In a monitoring product, that is fabricated evidence
about a real employee. (`/api/cron` has always done the same check the other way
round — `if (!secret) return false; // fail closed`.)

The gate cannot simply be closed: agents already installed on customer machines
would stop reporting the moment it was, and they cannot be updated from here. So
the gate is **staged**, and every stage is chosen by the owner via environment
variables.

---

## The contract the desktop agent must implement

Send the shared secret on **every** POST to both endpoints, using either form.

**Preferred — dedicated header:**

```http
POST /api/track-activity HTTP/1.1
Host: <your-deployment>
Content-Type: application/json
X-Ingest-Secret: <DESKTOP_INGEST_SECRET verbatim>
```

**Alternative — bearer token** (use this if your HTTP stack strips unknown
headers):

```http
Authorization: Bearer <DESKTOP_INGEST_SECRET verbatim>
```

Rules:

- **Header name** — `X-Ingest-Secret` (case-insensitive, as with all HTTP
  headers) or `Authorization`.
- **Value format** — the secret exactly as configured on the server: an opaque
  ASCII string, generated with `openssl rand -hex 32` (64 hex characters). No
  quoting, no base64 wrapper, no `Bearer` prefix in `X-Ingest-Secret`, and no
  surrounding whitespace. In the `Authorization` form the prefix is
  `Bearer ` (one space); surrounding whitespace around the token is trimmed.
- **Precedence** — if `X-Ingest-Secret` is present and non-empty it is the value
  checked; `Authorization` is only consulted when it is absent.
- **Both endpoints use the same secret.** There is one variable, not two.
- **Transport** — HTTPS only. This is a bearer credential: anything that can read
  the request can replay it.
- **Storage on the machine** — the secret must not be world-readable, must not be
  logged, and must not be shipped in a crash report. It is shared across
  installations, so a leak from any one machine compromises every tenant.
- **Comparison is constant time** on the server (SHA-256 digest of each side, then
  `crypto.timingSafeEqual` over two 32-byte buffers), so neither the length nor
  the content of the secret can be recovered by timing the endpoint.

### What a rejected request looks like

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{"error":"Unauthorized"}
```

The body is identical for a missing credential, a wrong credential, and a
server that is misconfigured — deliberately, so a caller cannot probe the
server's configuration. Nothing about the expected secret is ever returned or
logged.

**How the agent should react to a 401:** treat it as fatal for that payload —
do **not** retry in a tight loop, and do not drop the local buffer. Surface it
as "tracking not authorized: check the ingest secret", back off (minutes, not
seconds), and retry later. A 401 means the credential is wrong or missing, and
retrying without changing it cannot succeed.

Unchanged responses, for reference:

- `400` — malformed payload (e.g. no activities, missing `developer_id` or
  `image_data`).
- `403` — `developer_id` does not match a known developer.
- `413` — payload over the limit (500 activities; ~8 MB of base64 image data).
- `500` — server-side failure; safe to retry with backoff.
- `200` — accepted. `/api/track-activity` answers `{"success":true,...,"deprecated":true}`;
  it validates and acknowledges but stores nothing, because the per-signal
  tables are the system of record.

Authentication is checked **before** anything else — before the body is parsed,
before any database or storage call — so a rejected request cannot consume
Supabase capacity.

---

## The three stages

Both variables are read per request, so a stage change is an environment change
plus a restart/redeploy — no code change.

| `DESKTOP_INGEST_SECRET` | `DESKTOP_INGEST_ENFORCE` | Stage | Unauthenticated request |
| --- | --- | --- | --- |
| unset | unset | **1. open** (default) | **accepted** — today's behaviour; loud warning at startup and throttled `warning` events |
| set | unset | **2. observe** | **accepted**, and recorded so the fleet's progress is visible |
| set | set | **3. enforce** | **401** |
| unset | set | misconfigured | **401** — fails closed |

`DESKTOP_INGEST_ENFORCE` is on for `1`, `true`, `yes`, `on` (case-insensitive,
whitespace trimmed). Anything else — including `0`, `false`, and empty — is off.

### Stage 1 — open (what runs today)

Nothing is required and nothing changes: existing agents keep reporting. But the
hole is no longer silent. On first load each route logs

```
[ingest] /api/track-activity: DESKTOP_INGEST_SECRET is NOT set — this endpoint
accepts UNAUTHENTICATED writes from anyone who knows a developer id. …
```

and unauthenticated requests are recorded to `system_events`
(`api.ingest_unauthenticated_accepted`, severity `warning`, source `api`),
visible in **Admin → System Health**.

### Stage 2 — observe

Set `DESKTOP_INGEST_SECRET` and roll the same value out to the desktop agents.
Updated agents authenticate; agents that have not been updated **still work**,
and each one is recorded. That count is the migration's progress bar: when it
reaches zero and stays there, every machine has been updated.

### Stage 3 — enforce

Set `DESKTOP_INGEST_ENFORCE=1`. Unauthenticated requests now get a 401 and are
recorded as `api.ingest_unauthenticated_rejected`. The hole is closed.

Enforcement is a **separate switch from the secret** on purpose: the owner can
sit in stage 2 for as long as the fleet needs, then close the gate without
touching secrets — and can reopen it instantly (unset the one variable) if the
rollout turns out to be incomplete, without rotating anything.

### Telemetry volume

Events are throttled to at most one per route per process per 10 minutes; the
row carries `context.count` — how many unauthenticated requests that process saw
since the last one. So a fleet of legacy agents produces a readable trickle, not
a flood, and `count` is what to watch shrink.

Recording is best effort and can never affect a response: it goes through
`recordEvent()` in `src/utils/systemEvents.js`, which never throws, and the
call site swallows anything anyway. The secret is never part of an event — only
a route name, a machine-readable reason (`missing_credential`,
`invalid_credential`, `no_secret_configured`, `enforce_without_secret`), a stage
and a count.

---

## Rollout order for the owner

1. **Generate the secret:** `openssl rand -hex 32`. Keep it out of git and out of
   chat; treat it like a password.
2. **Update the desktop agent** to send `X-Ingest-Secret` on every ingest POST,
   reading it from its own configuration. Ship that build.
3. **Set `DESKTOP_INGEST_SECRET`** in the production environment and redeploy.
   → Stage 2. Updated agents authenticate; old agents keep working. Nothing
   breaks, so this step is safe to do first, before any machine is updated.
4. **Watch Admin → System Health** for `api.ingest_unauthenticated_accepted`.
   Roll the updated agent out to customer machines while that count falls.
5. **Wait for zero** — no accepted-unauthenticated events for at least one full
   reporting cycle (long enough to cover machines that are off, on leave, or
   offline; a week is a reasonable floor, and remember laptops that come back
   from a month of leave).
6. **Set `DESKTOP_INGEST_ENFORCE=1`** and redeploy. → Stage 3. The endpoints are
   now closed.
7. **Confirm** — no `api.ingest_unauthenticated_rejected` events; if any appear,
   they name machines still on the old build. Unsetting
   `DESKTOP_INGEST_ENFORCE` returns to stage 2 immediately, which is the rollback
   if a straggler is found.

Do **not** set `DESKTOP_INGEST_ENFORCE` before `DESKTOP_INGEST_SECRET`: that
combination is a misconfiguration and every request is rejected (fail closed, by
design — the alternative would be to silently reopen the hole).

## Rotation

Rotating the secret is a stage-2-style exercise: the server holds exactly one
value at a time, so a rotation must land on the agents and the server together,
or agents will 401 in stage 3. The low-risk sequence is: unset
`DESKTOP_INGEST_ENFORCE` (back to stage 2) → change the secret on the server and
in the agents → confirm the accepted-unauthenticated count is zero → set
`DESKTOP_INGEST_ENFORCE=1` again.

## Scope

This closes the *unauthenticated writer* hole. The shared secret is a fleet-wide
credential, not a per-machine identity: it proves the caller has the secret, not
that it is the machine belonging to `developer_id`. A leaked secret still allows
posting as any developer. Per-agent credentials (an enrolment token exchanged for
a per-device key, revocable individually) are the next step; the endpoints'
other defences — server-derived `organization_id`, column allow-listing, identity
validation, payload caps, private storage bucket — remain in force regardless.
