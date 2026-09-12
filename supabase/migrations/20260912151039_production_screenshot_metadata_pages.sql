begin;
-- Both timestamps are timestamptz. COALESCE needs no timezone-dependent cast.
create index if not exists screenshots_monitoring_captured_page_idx
 on public.screenshots(organization_id,developer_id,(coalesce(timestamp,created_at)) desc,id desc);

create function public.monitoring_screenshot_page(
 p_organization_id uuid,p_developer_id uuid,p_start timestamptz,p_end timestamptz,
 p_cursor_time timestamptz default null,p_cursor_id text default null,p_limit int default 24
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare cursor_id uuid; result jsonb;
begin
 if p_organization_id is null or p_developer_id is null or p_start is null or p_end is null
  or not isfinite(p_start) or not isfinite(p_end) or p_start>=p_end
  or p_limit is null or p_limit<1 or p_limit>48
  or (p_cursor_time is null)<>(p_cursor_id is null) then
  raise exception 'SCREENSHOT_PAGE_INVALID' using errcode='22023';
 end if;
 if p_cursor_time is not null then
  if not isfinite(p_cursor_time) or p_cursor_time<p_start or p_cursor_time>=p_end
   or p_cursor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'SCREENSHOT_PAGE_INVALID' using errcode='22023';
  end if;
  cursor_id:=p_cursor_id::uuid;
 end if;
 -- Empty identity cannot satisfy monitoring.view_own. The existing helper
 -- checks current organization, active typed membership and effective override.
 if p_organization_id is distinct from public.auth_org()
  or not coalesce(public.auth_monitoring_record_read(p_organization_id,'{}'::jsonb),false) then
  raise exception 'SCREENSHOT_PAGE_FORBIDDEN' using errcode='42501';
 end if;
 -- Count and limited metadata share one MVCC statement snapshot. All table
 -- reads execute as the caller, retaining permission and history RLS.
 with scoped as not materialized (
  select s.*,coalesce(s.timestamp,s.created_at) as captured_at from public.screenshots s
  where s.organization_id=p_organization_id and s.developer_id=p_developer_id
   and coalesce(s.timestamp,s.created_at)>=p_start and coalesce(s.timestamp,s.created_at)<p_end
 ), candidates as materialized (
  select * from scoped where p_cursor_time is null or (captured_at,id)<(p_cursor_time,cursor_id)
  order by captured_at desc,id desc limit p_limit+1
 ), page as materialized (
  select * from candidates order by captured_at desc,id desc limit p_limit
 )
 select jsonb_build_object(
  'total',(select count(*) from scoped),
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'organization_id',organization_id,'developer_id',developer_id,
    'filename',filename,'storage_path',storage_path,'public_url',public_url,
    'width',width,'height',height,'size_kb',size_kb,'mime_type',mime_type,
    'app_active',app_active,'is_annotated',is_annotated,
    'timestamp',timestamp,'created_at',created_at,'captured_at',captured_at
   ) order by captured_at desc,id desc) from page),'[]'::jsonb),
  'next_cursor',case when (select count(*) from candidates)>p_limit then
   (select jsonb_build_object('time',captured_at,'id',id) from page order by captured_at asc,id asc limit 1)
   else null end
 ) into result;
 return result;
end $$;
revoke all on function public.monitoring_screenshot_page(uuid,uuid,timestamptz,timestamptz,timestamptz,text,int) from public,anon,service_role;
grant execute on function public.monitoring_screenshot_page(uuid,uuid,timestamptz,timestamptz,timestamptz,text,int) to authenticated;
commit;
