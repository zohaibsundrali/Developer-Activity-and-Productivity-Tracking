# Production worker configuration and delivery checks

Run the read-only configuration checker from the repository root with the deployment's environment loaded into your shell:

```sh
node scripts/check-worker-readiness.mjs
```

For a locally secured environment file on Node 20.6 or later:

```sh
node --env-file=.env.local scripts/check-worker-readiness.mjs
```

The checker makes no network requests and prints only known variable names, status, and fixed diagnostic codes. Exit 1 means required configuration is missing or malformed; exit 0 only means the local checks passed. It does not authenticate credentials, query a database, test delivery, or verify deployed environment variables. Do not paste environment files or secret values into issues or chat.

Required application and worker names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, and `CRON_SECRET`. Production URLs must be trusted HTTPS origins. Never place the service credential in a public variable. Dedicated `SESSION_COOKIE_SECRET` and `VERIFICATION_CODE_PEPPER` are recommended; coordinate secret rotation with active sessions and outstanding verification codes.

Paid billing requires `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. The checker treats their absence as incomplete full-application configuration even if a Free-only deployment intentionally disables paid checkout. It accepts standard and restricted Stripe keys, but cannot check their permissions, test/live consistency with database price mappings, webhook subscriptions, or customer portal settings. `BILLING_GRACE_PERIOD_DAYS`, if configured, must be nonnegative; the application default is seven days.

Mail selects `RESEND_API_KEY` first, otherwise both `GMAIL_EMAIL` and `GMAIL_APP_PASSWORD`. Without a provider it records mocked mail instead of delivery. Resend needs `EMAIL_FROM` or `RESEND_FROM` on a verified sending domain; the default `onboarding@resend.dev` is unsuitable for arbitrary production recipients. Configuring Gmail alongside Resend does not enable automatic provider failover.

The checked-in Vercel schedule calls `/api/cron` daily at 06:00 UTC. Deployed scheduler access must include `Authorization: Bearer <CRON_SECRET>`; do not put the secret in a URL. Daily scheduling means recovery and queued work can wait until the next run, and bounded batches may require multiple runs. Verify the hosting plan's cron frequency and function duration before choosing a faster schedule. A configuration check cannot prove the deployed scheduler has actually run.

Email transport behavior now has these bounds:

- Resend uses a 10-second abort signal covering its request and response body. A timed-out or aborted delivery is uncertain and receives no immediate resend by the shared retry loop.
- SMTP DNS, connection, greeting, and socket inactivity each have a 10-second timeout. These are separate phases, **not a ten-second total deadline**. The transport closes after completion, and cleanup errors cannot replace a confirmed send with failure.
- Email log database requests each use a 10-second request deadline. Logging failure remains best effort and does not fail an otherwise confirmed send.
- Password recovery does not invoke its Supabase fallback when the first delivery is uncertain. Both recovery Auth clients have request deadlines.

An aborted request does not prove the remote action rolled back. The proposal decision outbox deliberately retries unconfirmed deliveries on a later cron run and remains at least once: duplicates are possible after a lost acknowledgement. This change prevents immediate timeout retries; it does not promise exactly-once email delivery. Pending signup, invitation, and profile provisioning reservations remain available for their existing recovery workflows.

Before declaring production ready, verify applied migration history, deployed environment scope, successful authorized cron logs and queue progress, an actual invitation/verification/password-reset email, and notification delivery in the intended organization. Complete Stripe checkout/cancel/webhook retry tests in test mode using the deployment's configured products and prices. Verify retention and deletion progress on disposable test data before using those destructive flows for real organizations. None of these provider or production checks is performed by the local checker.
