begin;
-- Use captured event time for app/site aggregates, not their later upload time.
-- Historical rows remain stored; upgrading can restore permitted history.
create or replace function public.auth_tracking_history(p_org uuid,p_row jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public,app_private as $$
declare days bigint; recorded timestamptz; value text;
begin
 if p_org is distinct from public.auth_org() or p_org is null then return false; end if;
 days:=app_private.plan_limit(p_org,'tracking_history_days');
 if days=-1 then return true; end if;
 if p_row ? 'site' and (p_row ? 'first_seen' or p_row ? 'last_seen') then
  value:=coalesce(nullif(p_row->>'first_seen',''),nullif(p_row->>'last_seen',''),nullif(p_row->>'created_at',''));
 elsif p_row ? 'app_name' or p_row ? 'app_name_raw' then
  value:=coalesce(nullif(p_row->>'start_time',''),nullif(p_row->>'end_time',''),nullif(p_row->>'tracked_at',''),nullif(p_row->>'created_at',''));
 else
  value:=coalesce(nullif(p_row->>'timestamp',''),nullif(p_row->>'tracked_at',''),nullif(p_row->>'start_time',''),
   nullif(p_row->>'session_start',''),nullif(p_row->>'login_time',''),nullif(p_row->>'created_at',''));
 end if;
 recorded:=value::timestamptz;
 return coalesce(isfinite(recorded) and recorded>=now()-make_interval(days=>least(days,2147483647)::integer),false);
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
revoke all on function public.auth_tracking_history(uuid,jsonb) from public,anon;
grant execute on function public.auth_tracking_history(uuid,jsonb) to authenticated;

-- Only already opted-in cleanup jobs use this helper. No deletion or policy
-- activation occurs in this migration. Open or malformed intervals are kept.
create or replace function app_private.retention_recorded(p_row jsonb) returns timestamptz
language plpgsql stable set search_path=pg_catalog as $$
declare value text; recorded timestamptz;
begin
 if (p_row ? 'end_time' and nullif(p_row->>'end_time','') is null)
  or (p_row ? 'session_end' and nullif(p_row->>'session_end','') is null)
  or (p_row ? 'site' and p_row ? 'last_seen' and nullif(p_row->>'last_seen','') is null) then return null; end if;
 if p_row ? 'site' and (p_row ? 'first_seen' or p_row ? 'last_seen') then
  value:=coalesce(nullif(p_row->>'last_seen',''),nullif(p_row->>'first_seen',''),nullif(p_row->>'created_at',''));
 else
  value:=coalesce(nullif(p_row->>'end_time',''),nullif(p_row->>'session_end',''),nullif(p_row->>'timestamp',''),
   nullif(p_row->>'tracked_at',''),nullif(p_row->>'start_time',''),nullif(p_row->>'session_start',''),
   nullif(p_row->>'login_time',''),nullif(p_row->>'created_at',''));
 end if;
 recorded:=value::timestamptz;
 if not isfinite(recorded) then return null; end if;
 return recorded;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;
-- Preserve the original private helper ACL; no new public capability.
revoke all on function app_private.retention_recorded(jsonb) from public,anon,authenticated;
commit;
