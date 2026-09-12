# Verify PR #103 and #104 database objects

Run the entire [`production-migration-verification.sql`](../scripts/sql/production-migration-verification.sql) file in the target project's Supabase SQL Editor as its database administrator. This is a **read-only diagnostic**, not a migration or repair bundle. It reads PostgreSQL catalogs only; it does not read customer/Auth records or invoke application routines. It tolerates missing schemas, tables and functions.

The result contains one summary per migration and details for each failed check:

- `CATALOG_CHECKS_MATCH`: the listed catalog properties match the source migration.
- `REVIEW_REQUIRED`: examine detail rows. `MISSING` means an expected object was not found; `DRIFT` compares expected and actual properties.

There are 61 checks covering the seven migration versions listed in the file header. Checks include function bodies, security mode, volatility, search path, argument defaults and effective application-role execute grants; private-table RLS, policies and application-role privileges; declared column types/nullability; trigger attachment/timing/enabled state; and the pending-signup unique partial index. Set `include_passes` to `true` near the start to display successful detail checks too.

A match is **not proof of complete production readiness**. This diagnostic does not comprehensively verify table defaults, primary/foreign/check constraints, other indexes, schema grants/ownership, arbitrary custom-role grants, prerequisite migrations, customer data, migration ledger entries, or provider/web/desktop behavior. Function-body fingerprints can flag formatting-only changes. Later intentional migrations can also cause legitimate drift; compare the reported difference before taking action. Do not replay previously completed migration bundles solely because a row requires review.

The header records SHA-256 fingerprints of the exact seven source files. When those sources intentionally change, review/update the expected catalog manifest and rerun the fixture tests; do not blindly replace fingerprints to silence a failure.

## Offline regression

Use a fresh, disposable PostgreSQL 16 Docker container with networking disabled and an empty database, then run:

```sh
python3 scripts/test-migration-verification.py <container-name> <empty-database-name>
```

The harness applies all seven **actual migration files** to minimal prerequisite fixtures. It checks absent schemas, a partially installed set, a complete set, and deliberate function-security/grant/trigger/index drift. Fixture prerequisite routines are stubs; these tests validate the diagnostic, not business workflows. The harness mutates only its disposable fixture database and must never target production.
