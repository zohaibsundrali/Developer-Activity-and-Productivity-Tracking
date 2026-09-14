# Android field tracking — review release

Android is the first supported mobile platform. iPhone remains a later phase.

## Included

- Native Android 8+ workday timer with explicit Start, Pause, Resume and Stop. A foreground notification exposes Stop while recording. GPS capture stops during pauses and after completion; there is no boot tracking or background-location permission.
- Elapsed-time measurement, persisted checkpoints, offline completed-session queue, safe process-interruption recovery and idempotent upload. Recovery ends at the last saved checkpoint, so a killed process does not invent working time.
- Encrypted sign-in tokens using Android Keystore; app data excluded from backups. Only the matching workspace, organization and typed profile can upload its saved sessions.
- Pending work and GPS can be exported through Android's document picker. A phone copy can be removed only after a successful backup in the current app session, with a separate confirmation. Exports contain sensitive location history; the user chooses their destination.
- Work-site coordinates and radius management, own GPS history, and organization history requiring attendance-wide access plus monitoring permission. Accuracy-aware inside/outside/uncertain labels use current work-site settings; mock locations remain uncertain.
- Completed sessions create unallocated, non-billable time logs and follow existing timesheet approval locks. UTC Monday crossings split into the appropriate weeks. Duplicate retries do not add hours; overlapping work is rejected atomically.
- Existing tracking retention removes expired mobile GPS/session payloads while retaining business time logs.

## Boundaries

This is a debug review build, not a signed Play Store release. There is no live staff map, automatic geofence attendance/pay action, mobile task selector, iPhone app, or background restart. Device location and mock flags are estimates, not proof of attendance. Active sessions remain local until completion and sync.

Limits: 24-hour session span, 100 work segments, 2,000 location points, 100 pending sessions per signed-in identity, 100 configured sites per organization, and uploads within seven days. Overlaps, approval locks and expired uploads require resolving the hours with a manager; export the pending backup before removing a phone copy. Android force-stop, battery policies or storage exhaustion can interrupt capture. Verify these on physical devices before employee rollout.

## Build and rollout

The app lives in `mobile/android`. Use Java 17, Android SDK 36/build-tools 36.0.0 and the checked-in Gradle 8.13 wrapper:

```sh
cd mobile/android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug
./gradlew :app:connectedDebugAndroidTest
```

The GitHub workflow runs the lifecycle instrumented test on Android API 35 and publishes the debug APK, SHA-256 checksum and reports. Debug package ID is `com.devtrack.field.debug`. The test uses a local unreachable fixture server and synthetic GPS; no production credentials or employee data are used.

Before staging use, merge the prerequisite feature branches and apply `20260914085225_production_mobile_field_tracking.sql` after the earlier migrations. Deploy the matching web routes, verify public Supabase configuration, then sign in with a linked staff account. Run Supabase security/performance advisors after staging DDL and verify real tenant roles, explicit denials, retention and approval locks. No hosted migration is applied by this PR.

Physical-device acceptance must cover approximate/precise location, notification denial, screen-off recording, airplane mode, pause/resume, process kill/reboot recovery, expired sign-in, permission revocation, pending backup and real authenticated sync. Release signing and store distribution remain separate setup work.

References: [Android location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions), [foreground location service requirements](https://developer.android.com/develop/background-work/services/fgs/service-types#location), [AGP 8.13 requirements](https://developer.android.com/build/releases/agp-8-13-0-release-notes).
