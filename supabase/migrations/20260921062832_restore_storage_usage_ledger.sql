-- Restore missing accounting after shared_account_billing.
-- Existing unmapped files are preserved in place, with an immutable private
-- inventory. Only files present during this transaction can enter that inventory;
-- every new upload still requires a verified organization and normal quota checks.
-- Storage objects themselves are changed ONLY by the Supabase Storage API.
-- This custom metadata trigger accounts for API operations in our private
-- ledger. Validate against the target Storage release in staging before apply;
-- Supabase recommends minimizing custom additions to its managed schema.
begin;
create table if not exists app_private.storage_usage (
  object_id text primary key,
  organization_id uuid not null references public.organizations(id),
  bytes bigint not null check (bytes >= 0)
);
create table app_private.storage_legacy_unassigned (
  object_id text primary key,
  bucket_id text not null,
  object_name text not null,
  bytes bigint not null check (bytes >= 0),
  original_record jsonb not null,
  inventoried_at timestamptz not null default now(),
  reason text not null default 'No current organization or application reference'
);
alter table app_private.storage_legacy_unassigned enable row level security;
revoke all on app_private.storage_legacy_unassigned from public,anon,authenticated,service_role;

create index if not exists storage_usage_org on app_private.storage_usage(organization_id);
revoke all on app_private.storage_usage from public,anon,authenticated;

create or replace function app_private.storage_org(p_bucket text,p_name text) returns uuid
language plpgsql stable security definer set search_path = pg_catalog,public
as $$
declare segment text; org uuid;
begin
  segment := split_part(p_name,'/',1);
  if p_bucket='task-submissions' then
    if segment='pm' then segment:=split_part(p_name,'/',2);
    elsif segment='submissions' then
      select d.organization_id into org from public.developers d where d.id::text=split_part(p_name,'/',2);
      return org;
    end if;
  end if;
  select id into org from public.organizations where id::text=segment;
  if org is not null then return org; end if;
  -- Legacy screenshot paths are attributed by the existing database record,
  -- never by guessing from an email local-part or trusting upload metadata.
  if p_bucket in ('screenshots','documents','monitoring') then
    select min(s.organization_id::text)::uuid into org from public.screenshots s
      where s.storage_path=p_name having count(distinct s.organization_id)=1;
  end if;
  return org;
end; $$;

create or replace function app_private.object_bytes(p_metadata jsonb) returns bigint
language plpgsql immutable set search_path = pg_catalog
as $$ declare size_text text; begin
  -- Storage inserts an empty metadata row before finalizing an upload. The
  -- final metadata UPDATE is checked too, so an empty reservation is not a bypass.
  if p_metadata is null then return 0; end if;
  size_text := p_metadata->>'size';
  if size_text is null or size_text !~ '^[0-9]+$' then
    raise exception 'STORAGE_SIZE_UNAVAILABLE: cannot account for object' using errcode='P0001';
  end if;
  return size_text::bigint;
end; $$;

-- Inventory and accounting are atomic with trigger installation. Unattributed
-- historical bytes are tracked separately, never charged to a guessed tenant.
-- The trigger below prevents their replacement, growth, rename or deletion.
lock table storage.objects in share row exclusive mode;
do $$ declare obj record; org uuid; begin
  for obj in select * from storage.objects
    where bucket_id in ('monitoring','screenshots','documents','org-files','invoices','task-submissions')
  loop
    org:=app_private.storage_org(obj.bucket_id,obj.name);
    if org is null then
      insert into app_private.storage_legacy_unassigned(object_id,bucket_id,object_name,bytes,original_record)
        values(obj.id::text,obj.bucket_id,obj.name,app_private.object_bytes(obj.metadata),to_jsonb(obj));
      continue;
    end if;
    insert into app_private.storage_usage(object_id,organization_id,bytes)
      values(obj.id::text,org,app_private.object_bytes(obj.metadata))
      on conflict(object_id) do update set organization_id=excluded.organization_id,bytes=excluded.bytes;
  end loop;
end; $$;

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
  byte_count:=app_private.object_bytes(new.metadata);
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
-- The usage RPC continues to sum the current workspace's shared billing group.
-- Legacy inventory is private operator evidence, not a tenant access grant.
revoke all on function app_private.account_storage_object() from public,anon,authenticated;
alter table app_private.storage_usage enable row level security;
revoke all on function app_private.storage_org(text,text),app_private.object_bytes(jsonb) from public,anon,authenticated;
drop trigger if exists app_storage_accounting on storage.objects;
create trigger app_storage_accounting after insert or update or delete on storage.objects
for each row execute function app_private.account_storage_object();
create or replace function public.auth_storage_history(p_bucket text,p_name text,p_created timestamptz)
returns boolean language sql stable security definer set search_path=pg_catalog,public,app_private
as $$ select case when p_bucket in ('monitoring','screenshots') then
  public.auth_tracking_history(app_private.storage_org(p_bucket,p_name),jsonb_build_object('created_at',p_created))
  else true end $$;
revoke all on function public.auth_storage_history(text,text,timestamptz) from public,anon;
grant execute on function public.auth_storage_history(text,text,timestamptz) to authenticated;
drop policy if exists tracking_object_history on storage.objects;
create policy tracking_object_history on storage.objects as restrictive for select to authenticated
  using(public.auth_storage_history(bucket_id,name,created_at));
commit;
