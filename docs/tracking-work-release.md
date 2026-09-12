# Project/task attribution for desktop time

Desktop users can select an authorized project and optionally an assigned task before starting a session. General tracking remains the default. The selection stays fixed through pause/resume and periodic/final saves; stop the session before changing work. Desktop options are loaded with the enrolled device identity and revalidated when selected tracking starts.

## Rollout

Run the complete `supabase/migrations/20260912075706_production_tracking_work_context.sql` once after existing device, project/task authorization and tracking migrations. Deploy the web change, then rebuild/install the coordinated desktop update. Older general sessions remain readable; older clients can continue unassigned tracking. Do not replay prior migration bundles.

Staging checks: use two different organizations and a developer with limited project/task access. Verify selectable work, General tracking, task reset after changing project, disabled selectors during tracking/pause, final session attribution, offline final-save recovery and a revoked-device request. Try direct inserts with a foreign project, another person's task and mismatched task/project; try changing an existing session's attribution. Confirm these fail. After a project/task is removed or reassigned, checkpoint updates to an already-saved session preserve its original attribution.

## Boundaries

The new nullable project_id/task_id fields are historical IDs. They deliberately have no deletion-blocking foreign keys: deleting a project/task must not delete recorded time or break supported deletion workflows. New attribution is validated against current organization, device, project visibility and assignment authority. Stored attribution cannot be changed through normal updates.

A session that was never accepted by the server before access was removed may stay queued for review; the client does not silently strip attribution to force it through. Existing local session recovery retains unconfirmed records. Project/task names are resolved through the viewing user's RLS access; deleted or inaccessible names appear as unavailable rather than leaking old titles. Historical unassigned rows show General tracking.

Session history and detail display the selected work. This release does not convert desktop time into task_time_logs, approved timesheets or invoices. Existing reports still aggregate desktop time by developer/day; automatic combination with task timers could double count work. Billing approval and reconciliation remain separate work.

General tracking remains usable if work options cannot be fetched. Selecting assigned work requires a current successful options check. Production Windows behavior and real Supabase calls need the staging checks above; offline tests do not certify those integrations.
