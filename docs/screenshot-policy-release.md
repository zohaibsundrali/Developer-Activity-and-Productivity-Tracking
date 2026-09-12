# Organization screenshot controls

The organization owner or an admin profile with the admin role controls screenshot collection. Staff see a read-only policy and retain the desktop Pause / Resume controls. Explicit organization.settings or organization.manage denials also deny policy changes. A developer profile with an admin-looking role does not gain policy administration.

The policy controls collection enabled/disabled and the capture interval (60–3600 seconds). Until configured, collection is enabled at 60 seconds. This replaces the desktop's random 1–60 second scheduling with a predictable, less frequent default. The employee cannot alter the organization's interval or enable screenshots against its policy. Blur is not part of this release.

## Deployment

First apply the prior capture-recovery migration `20260912070957_production_idempotent_screenshot_capture.sql` if it has not already been applied. Then run the complete `supabase/migrations/20260912074017_production_organization_screenshot_policy.sql` once. Deploy the web changes and rebuild/install the coordinated desktop release. Do not replay older bundles.

Verify with separate admin and employee accounts: change policy, reload the web page, inspect the employee's read-only view, and attempt the setter as the employee directly. Check another organization's settings remain inaccessible. On the desktop verify enabled, disabled, unavailable-policy, pause, resume, logout and reconnect behavior. Test existing queued captures without deleting them.

## Operational boundaries

Policy reads use the current authenticated organization. Missing/unavailable policy responses stop new desktop captures instead of guessing. Disabling collection blocks new private monitoring uploads and new screenshot records at the database layer; already committed captures remain readable under existing permissions and exact receipt acknowledgments remain possible. Pending local captures are retained, not deleted; re-enabling permits their recovery. Disabling is not a retention/delete action.

The interval schedules captures, not upload requests: reconnecting clients can replay several older captures together. Screenshot timestamps are client supplied, so this setting is not a cryptographic guarantee of capture frequency. Already-started operating-system or remote operations cannot be recalled. Database checks govern new writes; previously stored records and authorized reads follow existing retention/access rules.

Pause remains the existing whole-tracker pause: it pauses tracked time and other capture workers as well as screenshots. The organization cannot remove this employee control through this policy. Actual operating-system capture and hosted Storage behavior require a staging desktop verification before wider rollout.
