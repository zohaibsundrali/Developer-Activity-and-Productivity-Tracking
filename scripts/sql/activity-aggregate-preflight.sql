-- Read-only: rows returned need review before adding aggregate uniqueness.
-- No rows means no duplicate non-null keys were found by this check.
select 'app_usage' as source, session_id::text, app_name_raw::text as record_key,
 count(*) as duplicate_rows
from public.app_usage
where session_id is not null and app_name_raw is not null
group by session_id,app_name_raw having count(*)>1
union all
select 'browser_usage',session_id::text,site::text,count(*)
from public.browser_usage
where session_id is not null and site is not null
group by session_id,site having count(*)>1;
