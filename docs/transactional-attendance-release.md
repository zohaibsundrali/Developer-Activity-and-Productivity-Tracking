# Transactional attendance and report status consistency

Attendance check-in/check-out now runs in a caller-authenticated database transaction. Concurrent retries retain one typed daily record and the original checkout timestamp. The database checks effective self/manage permissions, active membership, matching profile and subscription write status. A checkout needs a real check-in; absence, holiday and leave entries are not silently converted into worked days.

Ordinary staff cannot insert or rewrite attendance clocks/status/source through direct table requests. They use the clock RPC. Explicit HR/manage correction access and the existing approved-leave integration remain supported. Existing records are not rewritten. The caller's valid calendar date remains the established contract; this release does not invent an organization timezone or a new backdating policy.

The attendance API validates requests and confirmed database responses, hides internal errors, and provides typed/filter-bound keyset pagination. A continuation probe handles hosted row caps smaller than requested pages. The personal attendance screen loads the complete selected range before presenting its totals and rejects stale account responses and overlapping submissions. Open prior-day records can be checked out from history, so a shift spanning midnight can still close on its original attendance day.

Task reports now use the application's canonical status mapping. Reviewed tasks remain awaiting approval, while done/approved tasks count as completed consistently across headline, project, team, trend and deadline summaries.

## Deployment

1. Confirm the existing typed leave authority migration `20260911180705_production_typed_leave_authority.sql` and subsequent leave-day contract migrations are installed.
2. Run the complete `supabase/migrations/20260912113733_production_transactional_attendance.sql` once.
3. Merge and deploy the matching web PR in the same maintenance window. Old service-write attendance endpoints must not remain deployed after the rollout. No desktop rebuild is required.
4. With disposable records, verify staff check-in/out and retries, denied direct edits, HR correction, approved leave, and a billing-locked organization. Verify an account switch during a pending request does not expose the previous user's records.

Live hosted role journeys remain unverified here. Missing legacy identity recovery still needs original evidence. Other report loader pagination and timezone/date-boundary findings remain separate work; this release does not claim every report is fully audited.

Validation: 4,272 web tests passed across 209 files. Production build and full isolated PostgreSQL audit harness passed. Attendance tests include real concurrent check-ins/checkout, typed collisions, permission overrides, blocked/cross-organization/missing-profile targets, invalid clocks, leave integration, pagination and overnight action selection. Hosted browser journeys still require deployment verification.
