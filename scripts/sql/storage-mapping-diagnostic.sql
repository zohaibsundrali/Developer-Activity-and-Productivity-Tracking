-- Read-only: inspect the reported object without changing ownership or storage.
select o.id, o.bucket_id, o.name,
       to_jsonb(o)->>'owner_id' as storage_owner_id,
       to_jsonb(o)->>'owner' as legacy_owner,
       o.metadata->>'size' as size_bytes,
       (select jsonb_agg(jsonb_build_object('organization_id',s.organization_id,'storage_path',s.storage_path))
        from public.screenshots s where s.storage_path=o.name) as matching_screenshot_records,
       (select jsonb_agg(org.id) from public.organizations org
        where org.id::text=split_part(o.name,'/',1)) as organization_path_matches
from storage.objects o
where o.id='00f1f28a-9c36-4ab3-aa18-ff7741792ac5'::uuid;
