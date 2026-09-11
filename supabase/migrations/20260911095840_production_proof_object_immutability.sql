begin;
-- Proof is an append-only upload. Both new and historical submission rows can
-- refer to it, so protection does not depend on a race-prone reference lookup.
-- Ordinary pm/ attachments in this shared bucket retain their existing rules.
create policy proof_object_update on storage.objects as restrictive for update to authenticated
using(bucket_id <> 'task-submissions' or name not like 'submissions/%')
with check(bucket_id <> 'task-submissions' or name not like 'submissions/%');
create policy proof_object_delete on storage.objects as restrictive for delete to authenticated
using(bucket_id <> 'task-submissions' or name not like 'submissions/%');
commit;
