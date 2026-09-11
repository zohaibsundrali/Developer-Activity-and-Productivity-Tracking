begin;
-- Public object downloads bypass Storage SELECT policies. Do not claim this
-- boundary is active until the bucket is private (set through Storage API/UI).
do $$ begin
 if exists(select 1 from storage.buckets where id='task-submissions' and public) then
  raise exception 'TASK_BUCKET_PUBLIC: set task-submissions to private through Storage settings before applying task-scoped access';
 end if;
end $$;
create or replace function public.auth_pm_storage_object(p_name text)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare parts text[];
begin
 parts:=string_to_array(p_name,'/');
 if cardinality(parts)<>4 or parts[1]<>'pm' or nullif(parts[4],'') is null or parts[4] in ('.','..') then return false; end if;
 return public.auth_attachment_parent(parts[2]::uuid,parts[3]::uuid);
exception when invalid_text_representation then return false;
end; $$;
revoke all on function public.auth_pm_storage_object(text) from public;
grant execute on function public.auth_pm_storage_object(text) to authenticated;
-- Existing other-bucket and proof policies remain in charge of their paths.
-- Querying tasks directly avoids recursion through attachment INSERT's lookup
-- of the just-uploaded storage.objects row.
create policy pm_storage_task_access on storage.objects as restrictive for all to authenticated
using(bucket_id<>'task-submissions' or split_part(name,'/',1)<>'pm' or public.auth_pm_storage_object(name))
with check(bucket_id<>'task-submissions' or split_part(name,'/',1)<>'pm' or public.auth_pm_storage_object(name));
-- The current UI deletes the attachment row, then its blob. Allow the same
-- authorized collaborators to finish cleanup; no metadata row is required.
create policy pm_storage_collaborator_delete on storage.objects for delete to authenticated
using(bucket_id='task-submissions' and split_part(name,'/',1)='pm' and public.auth_pm_storage_object(name));
commit;
