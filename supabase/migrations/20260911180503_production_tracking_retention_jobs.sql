begin;
-- Infrastructure only: no existing organization is opted into deletion.
-- Viewing history remains governed by plan limits, independently of retention.
create table public.tracking_retention_policies(
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 mode text not null check(mode in ('disabled','custom','plan')),
 days integer check(days between 1 and 36500), revision bigint not null default 1,
 updated_at timestamptz not null default now(), updated_by uuid not null,
 last_swept_at timestamptz,last_summary jsonb,
 check((mode='custom' and days is not null) or (mode<>'custom' and days is null))
);
alter table public.tracking_retention_policies enable row level security;
revoke all on public.tracking_retention_policies from public,anon,authenticated;
grant select on public.tracking_retention_policies to authenticated;
grant all on public.tracking_retention_policies to service_role;
create function public.auth_retention_owner(p_org uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_org=public.auth_org() and exists(select 1 from public.memberships m where m.organization_id=p_org
 and m.user_id=public.auth_app_user_id() and m.user_type=auth.jwt()->'app_metadata'->>'user_type'
 and m.user_type in ('admin','developer') and m.role='owner' and m.status='active'
 and ((m.user_type='admin' and exists(select 1 from public.admin_users a where a.id=m.user_id and a.organization_id=p_org and a.auth_user_id=auth.uid()))
 or (m.user_type='developer' and exists(select 1 from public.developers d where d.id=m.user_id and d.organization_id=p_org and d.auth_user_id=auth.uid())))
 and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='organization.manage'),true));
$$;
revoke all on function public.auth_retention_owner(uuid) from public,anon;
grant execute on function public.auth_retention_owner(uuid) to authenticated;
create policy retention_owner_read on public.tracking_retention_policies for select to authenticated using(public.auth_retention_owner(organization_id));
create schema if not exists app_private;
create table app_private.tracking_retention_files(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 screenshot_id text not null, snapshot jsonb not null, bucket text not null, path text not null,
 object_id text not null, object_updated_at timestamptz, status text not null default 'processing' check(status in ('processing','failed','completed','cancelled')),
 lease uuid not null default gen_random_uuid(), lease_until timestamptz not null default now()+interval '5 minutes',
 attempts integer not null default 0, claimed_at timestamptz, last_error text, created_at timestamptz not null default now(), completed_at timestamptz
);
create unique index retention_file_active on app_private.tracking_retention_files(bucket,path) where status in ('processing','failed');
create index retention_file_retry on app_private.tracking_retention_files(organization_id,status,lease_until);
alter table app_private.tracking_retention_files enable row level security;
revoke all on app_private.tracking_retention_files from public,anon,authenticated,service_role;

create function app_private.retention_cutoff(p_org uuid) returns timestamptz language plpgsql stable security definer set search_path=pg_catalog,public,app_private as $$
declare policy public.tracking_retention_policies%rowtype; keep_days bigint;
begin
 select * into policy from public.tracking_retention_policies where organization_id=p_org;
 if not found or policy.mode='disabled' then return null; end if;
 keep_days:=case when policy.mode='custom' then policy.days else app_private.plan_limit(p_org,'tracking_history_days') end;
 if keep_days is null or keep_days<1 then return null; end if; -- Unlimited/unknown never means delete everything.
 return now()-make_interval(days=>least(keep_days,36500)::integer);
end $$;
create function app_private.retention_recorded(p_row jsonb) returns timestamptz language plpgsql stable set search_path=pg_catalog as $$
declare value text;
begin
 -- An explicitly open session is never an expired closed record.
 if (p_row ? 'end_time' and nullif(p_row->>'end_time','') is null)
 or (p_row ? 'session_end' and nullif(p_row->>'session_end','') is null) then return null; end if;
 value:=coalesce(nullif(p_row->>'end_time',''),nullif(p_row->>'session_end',''),nullif(p_row->>'timestamp',''),
 nullif(p_row->>'tracked_at',''),nullif(p_row->>'start_time',''),nullif(p_row->>'session_start',''),
 nullif(p_row->>'login_time',''),nullif(p_row->>'created_at',''));
 return value::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;
-- Do not cascade into newer telemetry, delivery evidence or business records.
create function app_private.retention_referenced(p_table text,p_row jsonb) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare fk record; predicate text; referenced boolean;
begin
 for fk in select * from pg_constraint where contype='f' and confrelid=to_regclass('public.'||p_table) loop
  select string_agg(format('(to_jsonb(c)->%L) <> ''null''::jsonb and (to_jsonb(c)->%L)=($1->%L)',ca.attname,ca.attname,pa.attname),' and ')
  into predicate from unnest(fk.conkey,fk.confkey) keys(child,parent)
  join pg_attribute ca on ca.attrelid=fk.conrelid and ca.attnum=keys.child
  join pg_attribute pa on pa.attrelid=fk.confrelid and pa.attnum=keys.parent;
  execute format('select exists(select 1 from %s c where %s)',fk.conrelid::regclass,predicate) into referenced using p_row;
  if referenced then return true; end if;
 end loop;
 return false;
end $$;

create function public.set_tracking_retention(p_org uuid,p_mode text,p_days integer,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare result public.tracking_retention_policies%rowtype;
begin
 if not public.auth_retention_owner(p_org) then raise exception 'Only the permitted organization owner can change retention' using errcode='42501'; end if;
 perform 1 from public.organizations where id=p_org and status='active' for update;
 if not found or app_private.organization_deleting(p_org) then raise exception 'Organization is not active' using errcode='42501'; end if;
 if p_mode is null or p_mode not in ('disabled','custom','plan') or (p_mode='custom' and (p_days is null or p_days not between 1 and 36500))
 or (p_mode<>'custom' and p_days is not null) then raise exception 'Invalid retention policy' using errcode='22023'; end if;
 if p_mode<>'disabled' and p_confirm is distinct from true then raise exception 'Permanent deletion confirmation is required' using errcode='22023'; end if;
 insert into public.tracking_retention_policies(organization_id,mode,days,updated_by) values(p_org,p_mode,p_days,public.auth_app_user_id())
 on conflict(organization_id) do update set mode=excluded.mode,days=excluded.days,revision=tracking_retention_policies.revision+1,updated_by=excluded.updated_by,updated_at=now()
 returning * into result;
 return to_jsonb(result)||jsonb_build_object('inFlight',(select count(*) from app_private.tracking_retention_files where organization_id=p_org and status in ('processing','failed') and claimed_at is not null));
end $$;
revoke all on function public.set_tracking_retention(uuid,text,integer,boolean) from public,anon;
grant execute on function public.set_tracking_retention(uuid,text,integer,boolean) to authenticated;

-- Object claims fence ordinary Storage upserts and screenshot edits until the
-- provider result is reconciled. No managed Storage row is changed through SQL.
create function public.retention_object_available(p_bucket text,p_path text) returns boolean language sql stable security definer set search_path=pg_catalog,app_private as $$
 select not exists(select 1 from app_private.tracking_retention_files where bucket=p_bucket and path=p_path and status in ('processing','failed'));
$$;
revoke all on function public.retention_object_available(text,text) from public,anon;
grant execute on function public.retention_object_available(text,text) to authenticated;
create policy retention_object_insert on storage.objects as restrictive for insert to authenticated with check(public.retention_object_available(bucket_id,name));
create policy retention_object_update on storage.objects as restrictive for update to authenticated
 using(public.retention_object_available(bucket_id,name)) with check(public.retention_object_available(bucket_id,name));
create function public.guard_retention_screenshot() returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare item app_private.tracking_retention_files%rowtype;
begin
 select * into item from app_private.tracking_retention_files where status in ('processing','failed')
 and ((tg_op<>'INSERT' and screenshot_id=to_jsonb(old)->>'id') or (tg_op<>'DELETE' and path=to_jsonb(new)->>'storage_path')) limit 1;
 if found then
  raise exception 'Screenshot cleanup is in progress; retry after reconciliation' using errcode='55000'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function public.guard_retention_screenshot() from public,anon,authenticated;
create trigger retention_screenshot_fence before insert or update or delete on public.screenshots for each row execute function public.guard_retention_screenshot();

-- Small transactions; no provider call occurs while holding database locks.
create function public.sweep_tracking_retention(p_org uuid,p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare cutoff timestamptz; tbl text; row_data jsonb; obj record; n integer:=0; queued integer:=0; skipped integer:=0; matches integer; refs integer;
begin
 if p_limit not between 1 and 500 or p_limit is null then raise exception 'Invalid retention batch size' using errcode='22023'; end if;
 perform 1 from public.organizations where id=p_org and status='active' for update;
 if not found or app_private.organization_deleting(p_org) then return jsonb_build_object('deleted',0,'queued',0,'skipped',0); end if;
 update public.tracking_retention_policies set last_swept_at=now() where organization_id=p_org;
 cutoff:=app_private.retention_cutoff(p_org);
 if cutoff is null then return jsonb_build_object('deleted',0,'queued',0,'skipped',0); end if;
 -- Audit logs, submissions, projects, HR and financial records are NOT telemetry.
 foreach tbl in array array['keyboard_stats','mouse_activities','app_usage','browser_usage','developer_logins','developer_activities','productivity_sessions'] loop
  if to_regclass('public.'||tbl) is null then continue; end if;
  for row_data in execute format('select to_jsonb(t) from public.%I t where organization_id=$1 and app_private.retention_recorded(to_jsonb(t))<$2 limit $3 for update skip locked',tbl) using p_org,cutoff,p_limit loop
   if row_data->>'id' is null or app_private.retention_referenced(tbl,row_data) then skipped:=skipped+1; continue; end if;
   execute format('delete from public.%I t where organization_id=$1 and to_jsonb(t)->>''id''=$2',tbl) using p_org,row_data->>'id';
   n:=n+1;
  end loop;
 end loop;
 for row_data in select to_jsonb(s) from public.screenshots s where s.organization_id=p_org
  and app_private.retention_recorded(to_jsonb(s))<cutoff
  and not exists(select 1 from app_private.tracking_retention_files f where f.screenshot_id=s.id::text and f.status in ('processing','failed'))
  limit p_limit for update skip locked loop
  if app_private.retention_referenced('screenshots',row_data) then skipped:=skipped+1; continue; end if;
  -- Only canonical private monitoring objects have independently enforceable
  -- ownership. A mutable screenshot path cannot authorize deleting documents
  -- or legacy public-bucket bytes (even when no other record references them).
  if nullif(row_data->>'storage_path','') is null or nullif(row_data->>'developer_id','') is null
   or split_part(row_data->>'storage_path','/',1)<>p_org::text
   or split_part(row_data->>'storage_path','/',2)<>row_data->>'developer_id'
   or split_part(row_data->>'storage_path','/',3)='' then skipped:=skipped+1; continue; end if;
  -- Ambiguous paths/foreign references are preserved, never guessed.
  if exists(select 1 from public.screenshots s where s.storage_path=row_data->>'storage_path' and s.organization_id is distinct from p_org) then skipped:=skipped+1; continue; end if;
  select count(*) into refs from public.screenshots s where s.storage_path=row_data->>'storage_path';
  if refs>1 then
   delete from public.screenshots s where s.organization_id=p_org and s.id::text=row_data->>'id'; n:=n+1; continue;
  end if;
  select count(*) into matches from storage.objects o where o.name=row_data->>'storage_path' and o.bucket_id='monitoring';
  if matches=0 then
   -- No bytes exist at the canonical monitoring key; only the expired record remains.
   delete from public.screenshots s where s.organization_id=p_org and s.id::text=row_data->>'id'; n:=n+1; continue;
  end if;
  if matches<>1 then skipped:=skipped+1; continue; end if;
  select o.* into obj from storage.objects o where o.name=row_data->>'storage_path' and o.bucket_id='monitoring' for update;
  if (obj.bucket_id='monitoring' and split_part(obj.name,'/',1)<>p_org::text)
   or coalesce(obj.updated_at,obj.created_at)>=cutoff then skipped:=skipped+1; continue; end if;
  insert into app_private.tracking_retention_files(organization_id,screenshot_id,snapshot,bucket,path,object_id,object_updated_at)
   values(p_org,row_data->>'id',row_data,obj.bucket_id,obj.name,obj.id::text,obj.updated_at);
  queued:=queued+1;
 end loop;
 update public.tracking_retention_policies set last_summary=jsonb_build_object('deleted',n,'queued',queued,'skipped',skipped) where organization_id=p_org;
 return jsonb_build_object('deleted',n,'queued',queued,'skipped',skipped);
end $$;
revoke all on function public.sweep_tracking_retention(uuid,integer) from public,anon,authenticated;
grant execute on function public.sweep_tracking_retention(uuid,integer) to service_role;

create function public.claim_retention_file(p_org uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare job app_private.tracking_retention_files%rowtype; cutoff timestamptz; present boolean;
begin
 perform 1 from public.organizations where id=p_org and status='active' for update;
 if not found or app_private.organization_deleting(p_org) then return null; end if;
 select * into job from app_private.tracking_retention_files where organization_id=p_org and status in ('processing','failed') and lease_until<=now()
 order by created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 cutoff:=app_private.retention_cutoff(p_org);
 select exists(select 1 from storage.objects where bucket_id=job.bucket and name=job.path) into present;
 if present and job.claimed_at is null and (cutoff is null or app_private.retention_recorded(job.snapshot)>=cutoff) then
  update app_private.tracking_retention_files set status='cancelled',completed_at=now(),last_error='Policy no longer selects this file' where id=job.id;
  return jsonb_build_object('cancelled',true);
 end if;
 if present and not exists(select 1 from storage.objects where bucket_id=job.bucket and name=job.path and id::text=job.object_id and updated_at is not distinct from job.object_updated_at) then
  update app_private.tracking_retention_files set status='cancelled',completed_at=now(),last_error='Object changed; retained for a new scan' where id=job.id;
  return jsonb_build_object('cancelled',true);
 end if;
 update app_private.tracking_retention_files set status='processing',claimed_at=coalesce(claimed_at,now()),lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=job.id returning * into job;
 return jsonb_build_object('id',job.id,'lease',job.lease,'bucket',job.bucket,'path',job.path,'remove',present);
end $$;
revoke all on function public.claim_retention_file(uuid) from public,anon,authenticated;
grant execute on function public.claim_retention_file(uuid) to service_role;

create function public.finish_retention_file(p_job uuid,p_lease uuid,p_error text default null) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare job app_private.tracking_retention_files%rowtype; current_row jsonb;
begin
 select * into job from app_private.tracking_retention_files where id=p_job and lease=p_lease and status='processing' for update;
 if not found then return false; end if;
 if exists(select 1 from storage.objects where bucket_id=job.bucket and name=job.path) then
  update app_private.tracking_retention_files set status='failed',last_error=left(coalesce(p_error,'Storage deletion not confirmed'),1000),lease_until=now()+interval '5 minutes' where id=job.id;
  return false;
 end if;
 select to_jsonb(s) into current_row from public.screenshots s where s.organization_id=job.organization_id and s.id::text=job.screenshot_id for update;
 if current_row is not null and app_private.retention_referenced('screenshots',current_row) then raise exception 'Screenshot has a new dependent record; reconciliation required'; end if;
 if current_row is not null and current_row<>job.snapshot then raise exception 'Screenshot changed during retention; manual reconciliation required'; end if;
 -- Marking completed and deleting the protected record share one transaction.
 update app_private.tracking_retention_files set status='completed',completed_at=now(),last_error=null where id=job.id;
 if current_row is not null then delete from public.screenshots s where s.organization_id=job.organization_id and s.id::text=job.screenshot_id; end if;
 return true;
end $$;
revoke all on function public.finish_retention_file(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_retention_file(uuid,uuid,text) to service_role;
-- A freshly queued item is available immediately; only a worker claim leases it.
alter table app_private.tracking_retention_files alter column lease_until set default now();
revoke all on all functions in schema app_private from public,anon,authenticated;

create function public.retention_organizations(p_limit integer default 10) returns table(organization_id uuid)
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$begin
 return query select o.id from public.organizations o left join public.tracking_retention_policies p on p.organization_id=o.id
 where o.status='active' and not app_private.organization_deleting(o.id)
 and (p.mode in ('custom','plan') or exists(select 1 from app_private.tracking_retention_files f where f.organization_id=o.id and f.status in ('processing','failed')))
 order by p.last_swept_at nulls first,o.id limit greatest(1,least(coalesce(p_limit,10),50));
end $$;
revoke all on function public.retention_organizations(integer) from public,anon,authenticated;
grant execute on function public.retention_organizations(integer) to service_role;
create function public.get_tracking_retention(p_org uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare policy jsonb; counts jsonb;
begin
 if not public.auth_retention_owner(p_org) then raise exception 'Retention settings are owner-only' using errcode='42501'; end if;
 select to_jsonb(p) into policy from public.tracking_retention_policies p where organization_id=p_org;
 select jsonb_build_object('processing',count(*) filter(where status='processing'),'failed',count(*) filter(where status='failed'),
 'completed',count(*) filter(where status='completed'),'cancelled',count(*) filter(where status='cancelled')) into counts
 from app_private.tracking_retention_files where organization_id=p_org;
 return jsonb_build_object('policy',coalesce(policy,jsonb_build_object('mode','disabled','days',null)),'files',counts,'cutoff',app_private.retention_cutoff(p_org));
end $$;
revoke all on function public.get_tracking_retention(uuid) from public,anon;
grant execute on function public.get_tracking_retention(uuid) to authenticated;
commit;
