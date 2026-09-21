begin;
create or replace function app_private.account_storage_object() returns trigger
language plpgsql volatile security definer set search_path = pg_catalog,public,app_private
as $$
declare org uuid; old_org uuid; byte_count bigint; old_bytes bigint; used numeric; ceiling bigint;
begin
  -- Grandfathered objects are preserved, not a route for new unmetered uploads.
  -- Storage may touch access timestamps when serving an existing download.
  if tg_op in ('UPDATE','DELETE') and exists (
    select 1 from app_private.storage_legacy_unassigned where object_id=old.id::text
  ) then
    if tg_op='DELETE' then
      raise exception 'STORAGE_LEGACY_READ_ONLY: reconcile preserved legacy file before deletion' using errcode='55000';
    end if;
    if (to_jsonb(new)-array['last_accessed_at','updated_at']) is distinct from
       (to_jsonb(old)-array['last_accessed_at','updated_at']) then
      raise exception 'STORAGE_LEGACY_READ_ONLY: reconcile preserved legacy file before modification' using errcode='55000';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    delete from app_private.storage_usage where object_id=old.id::text;
    return old;
  end if;
  if new.bucket_id not in ('monitoring','screenshots','documents','org-files','invoices','task-submissions') then
    -- Moving to an unmetered bucket is not a supported application operation.
    if exists(select 1 from app_private.storage_usage where object_id=new.id::text) then
      raise exception 'STORAGE_BUCKET_NOT_ALLOWED' using errcode='P0001';
    end if;
    return new;
  end if;
  org:=app_private.storage_org(new.bucket_id,new.name);
  if org is null then raise exception 'STORAGE_MAPPING_REQUIRED: organization path required' using errcode='P0001'; end if;
  -- Supabase Storage Uploader.canUpload() runs a rolled-back test insert with
  -- version='1' and only mimetype/contentLength, before it knows the stored size.
  -- completeUpload() writes a UUID version and real size: it MUST take the
  -- strict accounting path below, even when declared contentLength is smaller.
  -- Source: supabase/storage src/storage/uploader.ts (canUpload/completeUpload).
  if to_jsonb(new)->>'version'='1'
    and jsonb_typeof(new.metadata)='object'
    and not (new.metadata ? 'size')
    and new.metadata-array['mimetype','contentLength']='{}'::jsonb then
    byte_count:=0;
  else
    byte_count:=app_private.object_bytes(new.metadata);
  end if;
  select organization_id,bytes into old_org,old_bytes from app_private.storage_usage where object_id=new.id::text;
  perform app_private.lock_quota(org);
  if old_org is distinct from org or byte_count > coalesce(old_bytes,0) then
    if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED: subscription requires attention' using errcode='P0001'; end if;
    ceiling:=app_private.plan_limit(org,'storage_mb');
    if ceiling<>-1 then
      select coalesce(sum(bytes),0) into used from app_private.storage_usage where organization_id in (select app_private.billing_organizations(org)) and object_id<>new.id::text;
      if used+byte_count > ceiling::numeric*1048576 then
        raise exception 'PLAN_LIMIT_REACHED: storage_mb. Remove files or upgrade.' using errcode='P0001';
      end if;
    end if;
  end if;
  insert into app_private.storage_usage(object_id,organization_id,bytes) values(new.id::text,org,byte_count)
    on conflict(object_id) do update set organization_id=excluded.organization_id,bytes=excluded.bytes;
  return new;
end; $$;
revoke all on function app_private.account_storage_object() from public,anon,authenticated;
commit;
