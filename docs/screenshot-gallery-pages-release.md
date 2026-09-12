# Screenshot pages, exact counts and signed-image renewal

The gallery previously combined two capped metadata queries, signed their entire results, and removed failed images before counting them. Counts could stop near 200 and a denied or temporarily unavailable image disappeared from the gallery. The modal also retained an old signed URL after refresh.

The new `monitoring_screenshot_page` RPC returns at most 24 visible records to the UI, an exact authorized count, and a keyset cursor. Ordering uses the effective capture time (`timestamp`, falling back to `created_at` only when timestamp is null) and UUID. Count and page share one SQL statement snapshot. The invoker function requires effective wide monitoring access and retains screenshot RLS/history policies; own-only staff, clients, foreign organizations and denied overrides cannot use it to bypass access. It returns display/file-reference metadata, not capture payloads or annotation text, and never signs Storage URLs.

The gallery has Next/Previous controls, exact totals, current-page timeline labels and unavailable-image tiles. Only the current page is signed. Metadata failures show a retry error with an unknown count; signing failures keep metadata and count intact. Initial loading, realtime INSERT/UPDATE refresh, polling, navigation and signing all retain typed identity/organization/developer guards. Cursor validation preserves PostgreSQL microseconds.

Visible-page URLs renew every eight minutes and on focus/visibility return; explicit Reload Images retries failures. Modal selection is an ID resolved from the current page, so renewed URLs reach the open modal. Page/identity changes close old selections. Private signing denial never revives legacy URL aliases.

## Deployment order

1. Merge PR #128 and its preceding dependencies if pending.
2. Run `supabase/migrations/20260912151039_production_screenshot_metadata_pages.sql` once in the target Supabase SQL editor, or through your normal migration runner. This adds the metadata RPC and supporting index; it does not change customer records. Apply it before deploying the new web UI.
3. Merge this PR and let the web deployment complete. No desktop rebuild is required.
4. Verify more than 200 captures, unavailable images, next/previous navigation, an open modal across renewal, hidden-tab return, denied monitoring and a second organization using disposable test identities.

The 4,732-test web suite passed across 230 files. After the final overview loading/error adjustment, all 18 affected controller/rendering tests passed and the final production build passed. The full local SQL regression and concurrency harness passed with exit 0, including the new 206-capture traversal, exact counts, timestamp fallback, retention and role/ACL checks. Existing image/repository lint warnings remain.

No production customer rows were read or changed; target OpenAPI schema metadata was inspected. The total is exact for each RPC statement, not a frozen multi-page browsing snapshot while new captures arrive. Large histories still incur count/RLS costs. Hosted Storage policies, realtime delivery and Windows/macOS capture need deployment verification. Website usage viewing, session freshness and legacy identity recovery remain separate work.
