# Reliability follow-up — 12 September 2026

This release follows PR #102. It adds application fixes plus two new migrations; do not replay the prior five-migration bundle.

## Implemented changes

- API and database authorization require a current typed profile/Auth link and matching role stores. Numeric role rank cannot safely resolve drift because HR and Manager permissions are not nested. Detached profiles, deleted/banned Auth identities and inconsistent current metadata fail closed. Deletion freezes and read-only cleanup receipts remain intact.
- Role-change partial failures preserve requested-role intent and explain retry/session refresh rather than suggesting that blindly syncing old membership state completes a demotion.
- Stripe cancellation, portal and checkout verify tenant identities, report lookup failures and refuse deletion-state uncertainty. Revision checks prevent stale request persistence from overwriting newer billing state. Production payment return URLs require a configured HTTPS application origin. Restricted key mode is recognized correctly.
- Invitation lookup distinguishes outage from invalid links, rejects invalid expiry, prevents token-response caching, and provides retry UI. Cleanup retains its ledger until actual Auth/profile absence is confirmed. Retried acceptance verifies the existing password instead of rewriting credentials after another lease may have finished.
- Browser logout clears all app identities and project SDK storage, stops refresh/realtime, and bounds remote cleanup before hard navigation. Current-session logout does not revoke other devices. Offline remote revocation/cookie deletion cannot be confirmed.
- Password recovery validates production HTTPS return origin and never logs raw Auth/SMTP exceptions. Missing/invalid configuration keeps anti-enumeration responses but sends no recovery message.
- Device API rejects malformed request bodies as validation errors. Separate desktop changes centralize refresh ownership, clear SDK headers on logout and stop local capture after confirmed remote revocation.

## Deployment order

1. Review the web and desktop pull requests. Confirm the PR #102 migrations are installed; existing marker checks establish presence only.
2. Optionally run `scripts/sql/current-identity-preflight.sql` as a read-only migration-owner check. It returns counts only. Resolve missing/incorrect links through verified identity recovery. For partial role changes, retry the intended change; do not blindly copy stale roles.
3. Apply these **new** migrations once, in order, during the established release window:
   - `supabase/migrations/20260912035637_production_current_profile_authority.sql`
   - `supabase/migrations/20260912035950_production_invitation_cleanup_confirmation.sql`
4. Deploy the matching web release. Existing users whose role changed must refresh their Auth session/sign in again; inconsistent stored identities require administrator recovery.
5. Install the desktop release with its pinned requirements; restart desktop sessions.

No migration starts a deletion, enables retention, or changes a user's identity. No production providers or customer records were mutated during development.

## Configuration and external checks

- Set `NEXT_PUBLIC_APP_URL` to the exact HTTPS app origin. It must not contain credentials, query strings or a path. Verify Supabase recovery redirect allowlists separately.
- Verify Stripe test credentials, webhook configuration and restricted-key permission to read customers/subscriptions and perform intended billing operations. Local mocks cannot prove provider acceptance or delivery.
- Verify real invitation email/password-recovery delivery with a disposable account and hosted `CRON_SECRET` scheduler operation.
- Use disposable staging organizations/files for Auth/Storage deletion, retention and failure recovery. Do not test deletion on a real working organization.
- Run Windows/macOS device capture, expiry, offline recovery and remote-revocation journeys. A confirmed revocation stops capture on the next bounded device poll; transient network errors do not invent a revocation.
- Inspect current-role navigation for all 12 roles, overrides and project scopes using real test accounts. Local API/SQL checks do not certify every live browser flow.

## Evidence boundaries

The previously merged PR #102 commit has a successful Vercel status. Read-only unauthenticated checks on 12 September returned HTTP 200 for `/` and HTTP 401 for devices, billing subscription, organization retention/deletion and effective permissions APIs. This checks public reachability and unauthenticated refusal only; it does not prove the new release has deployed or that authenticated tenant isolation works in production.

Final local regression: 174 web files / 3,845 tests passed; complete isolated PostgreSQL policy/concurrency suite passed; revised identity preflight passed; 25 desktop tests passed with the pinned real SDK and network blocked. Production build validation is recorded in the PR. Existing lint warnings remain; these results are not a zero-defect certification.
