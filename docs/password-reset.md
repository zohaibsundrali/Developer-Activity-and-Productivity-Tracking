# Password reset — the branded flow, and the one setting that still blocks it

**Status:** code done and building. The Supabase redirect allow-list was the
blocker; the owner fixed it on 2026-08-10 and it is **verified working** — see
section 2. Remaining step: deploy, because the live site still serves the old
browser-side flow. Measured against project `isaccqqjobuwfeaxlrwc`.

---

## 1. What was wrong, and what changed

Two separate complaints, one root each.

**The email did not look like ours.** `/forgot-password` called
`supabase.auth.resetPasswordForEmail()` in the browser. That works — but it also
makes **Supabase** send the message: Supabase's default template, Supabase's
sender, Supabase's wording. What landed in the inbox named a service the
recipient has never heard of, about an account they hold with us. On the one
email in the product where looking trustworthy matters most, it read like
phishing.

**The From name was the old product.** `EMAIL_FROM_NAME` defaulted to the string
`Developer Activity Tracking System` — the pre-rename product — so *every*
outbound email was signed by something that no longer exists.

### The fix

Delivery moved to a new server route; the token did not move at all.

```
POST /api/auth/forgot-password
  └── auth.admin.generateLink({ type: "recovery" })   ← Supabase mints the link
  └── renderTemplate("password_reset")                 ← our branding
  └── sendEmail(...)                                   ← our From, retries, email_log
```

`generateLink` returns **exactly the link `resetPasswordForEmail` would have
mailed, and sends nothing**. So Supabase still owns what a valid link is, how
long it lasts and the fact that it works once. There is still no reset table, no
code of our own invention and no second notion of expiry. Only the envelope is
ours.

The rest of the journey was already correct and is unchanged: the link signs the
person into `/reset-password`, they set and confirm a new password,
`supabase.auth.updateUser()` writes it, the recovery session is signed out, and
they land on `/login?reset=1` — which now shows a one-line "Your password has
been updated" banner. That query flag is copy only: nothing keys off it and a
stranger appending it still has to sign in.

### Files

| File | What it does |
| --- | --- |
| `src/app/api/auth/forgot-password/route.js` | **new** — mints the link, sends the branded email |
| `src/utils/emailTemplates.js` | **new** `password_reset` template; brand colour teal → indigo `#4840DD` |
| `src/utils/emailProvider.js` | default From name now comes from `BRAND_NAME` |
| `src/app/forgot-password/page.jsx` | posts to the route instead of mailing from the browser |
| `src/app/reset-password/page.jsx` | awaits the confirmation, then `/login?reset=1` |
| `src/app/login/page.js` | reads `?reset=1`, shows the banner |

---

## 2. THE BLOCKER — Supabase is refusing our own redirect URL

A recovery link carries `redirect_to`, and Supabase **will not honour a value
that is not on the project's allow-list**. It silently substitutes the project's
Site URL instead — no error, no warning.

Measured by minting real links and reading back what Supabase agreed to (no
email was sent; `generateLink` does not send):

| Asked for | Supabase returned |
| --- | --- |
| `http://127.0.0.1:3478/reset-password` | ✅ same — localhost is auto-allowed |
| `https://devtrack-blush.vercel.app/` | ✅ same — this entry was added by the owner |
| `https://devtrack-blush.vercel.app` (no trailing slash) | ❌ `http://localhost:3000` |
| `https://devtrack-blush.vercel.app/reset-password` | ❌ **`http://localhost:3000`** |
| `https://evil.example.com/steal` (control) | ❌ `http://localhost:3000` |

Read the middle three rows together — they are the whole finding.

**Supabase matches Redirect URLs as exact strings unless the entry contains a
`**` wildcard.** The owner added `https://devtrack-blush.vercel.app/`, and that
is precisely what now works: that one address, character for character. Not the
same URL without its trailing slash, and not `/reset-password` — which is the
only path this flow actually needs.

The substitution value in every refused row is `http://localhost:3000`, which is
the **Site URL** field. That is still the Supabase default and has not been
changed.

### What this means today

**Password reset is broken on the live site right now**, and was broken before
this change too — the old browser call sent the identical `redirectTo` and got
the identical substitution. Anyone clicking "Reset password" in the email is sent
to `http://localhost:3000`, which resolves to nothing on their phone or their
laptop. The new branded email does not fix this on its own; it is a dashboard
setting and only the project owner can change it.

### The fix — Supabase dashboard, two fields

**Authentication → URL Configuration**

1. **Site URL** — change `http://localhost:3000` to:
   ```
   https://devtrack-blush.vercel.app
   ```
2. **Redirect URLs** — add these, **with the `/**` on the end**:
   ```
   https://devtrack-blush.vercel.app/**
   http://localhost:3000/**
   ```
   The wildcard is the load-bearing part. A bare
   `https://devtrack-blush.vercel.app/` entry matches that one address and
   nothing else — measured above. `/**` covers `/reset-password` and every
   future auth landing page. Keeping localhost lets local development work.

When the real domain is bought, add it here at the same time as
`NEXT_PUBLIC_SITE_URL` (see `src/components/brand/brand.js`).

### RESOLVED — measured after the owner added the wildcard entries

| Asked for | Supabase returned | |
| --- | --- | --- |
| `https://devtrack-blush.vercel.app/reset-password` | same | ✅ |
| `https://devtrack-blush.vercel.app/join` | same | ✅ wildcard works |
| `http://localhost:3000/reset-password` | same | ✅ local dev still works |
| `https://evil.example.com/steal` (control) | `http://localhost:3000` | ✅ still refused |

The control row is the one to keep re-running if these entries are ever edited:
it proves the wildcard widened the allow-list to our own hosts **without**
opening it to arbitrary ones.

One loose end, deliberately left: **Site URL is still `http://localhost:3000`**
— that is what the refused row falls back to. Nothing in this flow depends on it
any more, because every redirect it asks for is now allow-listed explicitly. It
is worth setting to `https://devtrack-blush.vercel.app` anyway, since it is the
fallback for any Supabase-side template that uses `{{ .SiteURL }}`.

### How to confirm it worked

From the live site, click **Forgot password**, enter your address, then open the
email and hover the button. The URL should end with

```
…/auth/v1/verify?token=…&type=recovery&redirect_to=https%3A%2F%2Fdevtrack-blush.vercel.app%2Freset-password
```

If `redirect_to` still says `localhost`, the allow-list has not taken effect.

---

## 3. Environment variables

| Variable | Needed? | Effect if missing |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | `generateLink` unavailable → route falls back to Supabase's own unbranded email |
| `GMAIL_EMAIL` + `GMAIL_APP_PASSWORD`, or `RESEND_API_KEY` | **yes** | send path runs in mock mode, nothing is delivered → route falls back to Supabase's email |
| `NEXT_PUBLIC_APP_URL` | no | falls back to the origin the route was served on, which is correct on Vercel |
| `EMAIL_FROM_NAME` | no | defaults to `Verisade` |

Both fallbacks are deliberate: a reset email that looks wrong is better than no
way back into an account. Each one logs a line naming which path it took, so
"why did it look like Supabase again?" has an answer in the server logs.

---

## 4. What is deliberately NOT in this flow

- **No token of our own.** No reset table, no `reset_token` column, no nonce, no
  hash. A hand-rolled reset scheme is one of the easiest things in web software
  to get quietly, catastrophically wrong.
- **No account enumeration.** The route's reply is identical whether or not the
  address has an account — same status, same body. "No account with that email"
  would confirm workplace membership for any address someone can guess. The real
  reason is logged server-side only.
- **No caller-supplied redirect.** `redirectTo` is built on the server and a
  value in the request body is ignored. Otherwise someone could have a genuine
  reset link mailed to a victim pointing at a host they control.
- **No service-role key in the browser.** That is the whole reason this is a
  server route.
- **Nothing touched in `/api/auth/signup` or the change-password route.**

---

## 5. Tests

`tests/authRouting.test.js`

- the route mints Supabase's recovery link and invents no token scheme
- it builds `redirectTo` itself and never reads one from the body
- it answers identically whether or not the account exists
- it rate-limits by address and by caller
- it treats mock-mode `delivered: false` as "not sent" and falls back
- the rendered email is branded, carries the link in both HTML and text, refuses
  a `javascript:` URL, and mentions Supabase nowhere
