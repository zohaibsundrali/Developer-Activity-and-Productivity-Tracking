# Client support transaction deployment

Run `supabase/migrations/20260920174850_client_support_transactions.sql` in the existing project's Supabase SQL Editor **before deploying the accompanying application version**. This is additive and rerunnable; it preserves existing support threads and messages. The older application continues to work while the migration is installed.

Rollout status: the additive migration is published first. The new route implementation is held separately until installation is confirmed; the existing support routes continue to operate on main.

The pending client support route implementation requires these two service-role-only functions:

- `create_client_support_thread`: creates the thread and its first message in one transaction.
- `reply_client_support_thread`: saves the reply and updates thread activity in one transaction.

Both functions run with invoker privileges and recheck the active client profile and typed active membership. Creation also verifies the selected project belongs to the same organization and remains linked to the client. Reply checks thread ownership. They are not executable by anonymous or authenticated browser roles. Existing API authentication and plan checks remain in place.

There is intentionally no fallback to separate writes: without the migration support creation/replies return an error. Apply the migration and retry; do not remove the transaction call to bypass the error.

Verification completed in an isolated PostgreSQL 16 fixture (`database/tests/client_support_transactions.sql`): failed first-message insertion rolls back the new thread; failed thread activity update rolls back the reply; revoked/wrong-type members, wrong tenants, other clients and browser RPC callers are rejected. No production data was mutated during this verification. API tests are in `tests/clientSupportTransactions.test.js`.

Project pagination fixes require no SQL. Client project summaries/details fetch complete count-verified pages, retain organization and client-visibility filters, and split large ID lists into bounded requests. More than 50,000 returned rows fails explicitly instead of returning misleading partial totals. These multiple reads are not a database snapshot: concurrent same-count status edits can still appear at different instants. A refresh retrieves current state.
