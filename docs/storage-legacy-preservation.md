# Storage accounting and preserved legacy files

The 21 September repair restores billing without assigning historical files to
an organization by guess. Existing Storage objects stay in their existing private
buckets, with the same names and versions. The migration does not update or delete
Storage metadata or file content.

`app_private.storage_usage` tracks files whose organization can be established
from current paths or authoritative application references. Shared workspace
quota checks sum these bytes across the billing account.

Files present during migration that have no verified organization are recorded in
`app_private.storage_legacy_unassigned`, including their original metadata and byte
count. This is a private operator inventory, with RLS and no browser or service-role
table grants. It does not confer access to any tenant and these bytes are not
charged to an arbitrarily chosen customer. Existing object RLS still controls
downloads. Read-access timestamp updates remain possible; replacements, renames,
metadata changes and deletions are refused with `STORAGE_LEGACY_READ_ONLY`.

The inventory is a one-time preservation mechanism, not an upload destination.
New uploads without an identifiable organization are rejected. Valid new uploads
continue through the normal quota lock and billing checks. Supabase's rolled-back
permission probe uses `version='1'` with only provisional MIME/length metadata;
that probe is supported, but final upload versions require the stored `size` and
are checked again against the actual quota.

To restore a historical file to an application workspace, first establish its
ownership from independently verified records. Use a reviewed migration to update
the operator inventory/accounting and Storage APIs for any actual object changes.
Do not grant the inventory to browsers or remove its guards as a quota workaround.

Validation: `bash scripts/test-preserved-legacy-storage.sh` runs the isolated
preservation, access, upload-probe, finalization and shared-quota SQL tests. A live
QA upload/download/removal check passed, and all 289 original object records were
identical before and after repair. No customer file was used as a write test. To repeat the isolated live check, run
`E2E_ALLOW_WRITES=1 node scripts/test-storage-accounting-live.cjs`; it targets
only QA Test Org A and removes only the object it creates.
