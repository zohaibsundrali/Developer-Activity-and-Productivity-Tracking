# Public Windows download release

`/download` provides Windows requirements, account onboarding, capture/privacy guidance and release details. The landing navigation and footer link to it. It is public; installing the tracker still requires the existing authenticated employee/device workflow. Gmail addresses are accepted as workspace emails; the desktop uses a workspace password and does not implement Google OAuth. A client-only profile does not become an employee by downloading the app.

The page and `/api/desktop/download` read the same server-only `DESKTOP_PUBLIC_RELEASE` JSON. Missing or invalid evidence leaves the page in an unavailable state and the endpoint responds 503 without a redirect. Unconfigured, unsigned, unaccepted or future-dated releases are rejected. The endpoint ignores browser-supplied URLs. Both routes are dynamic, and the download redirect is no-store so removing configuration disables new download requests.

## Publishing an actual release

1. Merge desktop release fixes and confirm the exact Windows build commit. Use an actual-project build rather than any artifact containing `BUILD-NOT-CONFIGURED.txt`.
2. Verify the required hosted migrations, active staff identity and enrolled-device permissions. Do not assign guessed Auth links or broaden RLS to make login succeed.
3. Complete clean Windows install/login/capture/offline/lock/sleep/logout tests from the desktop release-candidate guide. Record results and the exact installer hash.
4. Sign the application, installer and uninstaller with the chosen publisher. Verify Authenticode and the publisher identity on the final installer after signing.
5. Upload that exact installer to a stable HTTPS `.exe` URL under operator-controlled hosting. Do not commit a binary or private certificate to the web repo. Verify the downloaded bytes match the SHA-256, and keep the previous accepted installer for rollback.
6. Configure the following server-only JSON on the web deployment, using real evidence. Deploy/check `/download`, follow the endpoint redirect and compare the downloaded hash once more.

Required fields: `schema_version: 1`, `platform: "windows-x64"`, semantic `version`, HTTPS `url` without credentials/query/fragment, lowercase `sha256` (64 hex), lowercase build `commit` (40 hex), integer `bytes`, certificate `publisher`, ISO `published_at` with timezone, `configured: true`, `signed: true`, `acceptance: "windows_installed_passed"`.

These fields record the operator's verified release; they are not a cryptographic attestation service. Do not copy a fixture manifest and flip flags to make it available. The app cannot infer certificate possession, physical testing or backend compatibility from successful CI. Signed test/setup builds and production approval are distinct.

Removing `DESKTOP_PUBLIC_RELEASE` disables new website download requests. It does not revoke copies already downloaded. Do not use expiring private artifact URLs as the public endpoint destination. This PR does not publish an installer or configure deployment/build variables.

## Current checks

Desktop PR16 is merged. Windows CI 34928098703 passed 222 tests, real dashboard construction, frozen diagnostics and installer compilation. Its artifact is unsigned and unconfigured, and is intentionally not offered here. The user has deferred saving GitHub build variables; no change to that configuration is made.

A read-only hosted schema check is recorded in `desktop-backend-preflight-2026-09-15.json`. Schema presence is not proof of correct role permissions or a completed device journey. No hosted migration or user data change was performed.

The current check found the required `capture_id` / `capture_payload` selection unavailable on both `keyboard_stats` and `mouse_activities` (PostgreSQL 42703), and `ingest_input_capture` absent from the visible API schema. Enrollment, task options, screenshot/idle policy, screenshot finalization, activity ingest and all three presence RPCs were visible. The input receipt migration `20260912093359_production_input_capture_receipts.sql` therefore needs migration-history/partial-state review before applying it once. Do not release the new desktop against this state: input batches can remain queued.

Run `bash scripts/test-input-capture-receipts.sh` for an isolated PostgreSQL regression of that migration. Before hosted application, confirm a recoverable backup, inspect migration history and whether either receipt column already exists, apply through the established migration workflow, and repeat schema plus actual employee capture checks. Existing input data must not be deleted to make migration replay succeed.

The available Supabase connector does not list this application's project, and an SSH connectivity check stopped at host-key verification. Consequently this turn performs no hosted DDL; authorized access to the correct project (or a verified server connection) is required for that step.
