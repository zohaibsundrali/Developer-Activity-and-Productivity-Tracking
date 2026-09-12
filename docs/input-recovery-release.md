# Durable keyboard and mouse aggregates

The desktop previously discarded keyboard window state before an upload succeeded and retried mouse INSERT requests without a stable batch identity. New input batches are committed locally first and delivered with immutable capture IDs. Exact retries acknowledge the existing record. Existing report fields and mouse percentage snapshot semantics remain intact.

The hosted OpenAPI definitions for keyboard_stats and mouse_activities were inspected read-only. No production records were read or modified during implementation. The migration adds receipt metadata to existing tables without deleting historical data. New captures require enrolled-device identity, correct organization and typed developer, and their own visible productivity session. Existing RLS and plan restrictions remain active.

Merge the coordinated web PR, apply the complete `supabase/migrations/20260912093359_production_input_capture_receipts.sql` migration once, then merge/rebuild/install the desktop PR. No historical duplicate cleanup is required for new capture IDs. Do not replay old migration bundles.

The desktop shows separate keyboard/mouse sync states. Saved batches survive network failure and restart under the same identity. Pausing holds replay; remaining batches after stopping retry in the next authorized tracking session. Queue storage is local and not encrypted. Unsaved intervals before a process crash cannot be recovered.

Before wider deployment, verify Windows listeners, disconnected tracking, reconnect/restart, parent-session ordering, account changes, pause/stop, revoked devices, disk capacity, lost responses and report totals against the hosted backend. Numeric aggregate payloads are retained; this release does not add typed-text or raw-key storage.
