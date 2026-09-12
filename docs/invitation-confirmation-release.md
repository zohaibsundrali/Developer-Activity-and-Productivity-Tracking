# Invitation confirmation and response privacy

Revoking a pending invitation now requires the database to return the exact invitation ID with revoked status. The mutation includes organization and pending-status conditions. An RLS-filtered zero-row update or a concurrently accepted invitation produces a clear failure instead of a false success message. Duplicate clicks are suppressed while confirmation/mutation is pending, and stale identity/unmount responses are ignored. A confirmed revocation followed by refresh failure is reported separately.

Invitation creation/listing no longer return raw database or exception details. Their responses explicitly use private, no-store and no-referrer headers because they can contain invitation tokens. Invalid JSON objects are rejected before writes; acceptance and lookup bound token length while preserving existing token formats and retry recovery semantics.

No database migration or desktop rebuild is required. Merge/deploy the web PR, then verify pending-invite revocation, concurrent acceptance, expired/revoked links and invitation email delivery in the hosted environment. Local regression verifies mocked provider/database boundary behavior; it does not prove delivery through the configured email service.
