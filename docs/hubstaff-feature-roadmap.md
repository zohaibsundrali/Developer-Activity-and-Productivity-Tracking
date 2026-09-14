# Workforce tracking implementation sequence

Updated 2026-09-14. This tracks implemented code separately from live acceptance.
No completion percentage or full Hubstaff parity is claimed.

| Order | Deliverable | Code status | Acceptance still required |
|---|---|---|---|
| 1 | Windows release pipeline, public-only packaging, offline setup diagnostics | Implemented in the paired desktop PR | GitHub Windows build, installed Windows journey, hosted migrations and device enrollment |
| 1 | Accurate homepage tracking controls and notices | Implemented in the web PR | Review rendered pages |
| 2 | Website usage viewing and export | Implemented in the website-usage PR | Permission-scoped reads, complete date ranges, offline aggregate updates |
| 3 | Shift scheduling and attendance exceptions | Pending | Timezones/DST, overnight shifts, overlap checks, scoped managers, employee view |
| 4 | Payroll preparation/export from approved time | Pending | Approved-only data, currencies/rates, corrections, duplicate exports and provider mapping |
| 5 | Provider payouts and external project integrations | Awaiting provider choice | Provider sandbox, credentials, webhook/retry/idempotency and reconciled results |
| 6 | Mobile time tracking, GPS and geofencing | Awaiting platform choice | Mobile build, consent/permissions, background/offline behavior, device testing |
| 7 | Desktop distribution improvements | Pending | Signed releases, update delivery, rollback, supported-OS matrix |
| All | Production identity, migration and integration acceptance | Not re-certified | Current identity diagnostics; real role accounts; email/payment/cron/retention journeys |

Existing code includes task/project tracking, pause/resume/stop, breaks, idle reminders,
screenshot policy, offline recovery, live device presence, timesheets and approvals,
attendance, leave, project boards, reports and client invoicing. These are not all
new work, and a passing local fixture is not proof of their hosted configuration.

An installed desktop must be verified on Windows with a disposable employee:
start a selected task, pause, resume, stop, disconnect/reconnect, restart after
queued activity, then sign out/revoke the device. Compare actual captured durations,
records and connection state in the web UI. Never repair legacy identities by
inventing profiles or copying another person's ownership.
