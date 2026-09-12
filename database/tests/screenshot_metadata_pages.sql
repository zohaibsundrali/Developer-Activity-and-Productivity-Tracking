\set ON_ERROR_STOP on
-- Reuse actual typed monitoring/history policies and their role regression.
\ir typed_monitoring_read_permissions.sql
reset role;
delete from screenshots;
alter table screenshots alter column id type uuid using gen_random_uuid();
alter table screenshots add primary key(id),add column timestamp timestamptz,
 add column filename text,add column storage_path text,add column public_url text,
 add column width int,add column height int,add column size_kb numeric,add column mime_type text,
 add column app_active text,add column is_annotated boolean,add column capture_metadata jsonb,
 add column annotation_text text;
\ir ../../supabase/migrations/20260912151039_production_screenshot_metadata_pages.sql
insert into screenshots(id,organization_id,developer_id,timestamp,created_at,filename,capture_metadata,annotation_text)
 select ('80000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000011',
 date_trunc('day',now())+interval '12 hours',now(),'capture.png','{"private":"not exported"}','not exported'
 from generate_series(1,205) n;
-- Null timestamp fallback is included once; upload time cannot override capture time.
insert into screenshots(id,organization_id,developer_id,timestamp,created_at) values
 ('80000000-0000-0000-0000-000000000206','76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000011',null,date_trunc('day',now())+interval '11 hours'),
 ('80000000-0000-0000-0000-000000000207','76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000011',now()-interval '2 days',now()),
 ('80000000-0000-0000-0000-000000000208','76000000-0000-0000-0000-000000000002','76000000-0000-0000-0000-000000000011',now(),now()),
 ('80000000-0000-0000-0000-000000000209','76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000012',now(),now()),
 ('80000000-0000-0000-0000-000000000210','76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000011',date_trunc('day',now())+interval '1 day',now()),
 ('80000000-0000-0000-0000-000000000211','76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000011',now()-interval '60 days',now());
-- A developer with an explicit wide grant may use the page, without bypassing RLS.
delete from user_permissions;
insert into user_permissions(user_id,user_type,permission_key,allowed,membership_id)
 select user_id,user_type,'monitoring.view',true,id from memberships where user_type='developer' and user_id='76000000-0000-0000-0000-000000000011';
select set_config('request.jwt.claims','{"org":"76000000-0000-0000-0000-000000000001","user":"76000000-0000-0000-0000-000000000011","type":"developer","app_metadata":{"user_type":"developer"}}',false);
set role authenticated;
do $$ declare result jsonb; cursor jsonb; total_rows int:=0; seen text[]:='{}'; entry jsonb;
 begin
 loop
  result:=monitoring_screenshot_page(auth_org(),'76000000-0000-0000-0000-000000000011',date_trunc('day',now()),date_trunc('day',now())+interval '1 day',(cursor->>'time')::timestamptz,cursor->>'id',24);
  if (result->>'total')::int<>206 or jsonb_array_length(result->'rows')>24 then raise exception 'Incorrect complete count or page bound'; end if;
  for entry in select value from jsonb_array_elements(result->'rows') loop
   if entry->>'id'=any(seen) or entry ? 'capture_metadata' or entry ? 'annotation_text' then raise exception 'Duplicate or excess metadata'; end if;
   seen:=array_append(seen,entry->>'id');total_rows:=total_rows+1;
  end loop;
  cursor:=result->'next_cursor';
  exit when cursor='null'::jsonb;
  if cursor->>'id' is distinct from result->'rows'->-1->>'id' then raise exception 'Wrong cursor'; end if;
 end loop;
 if total_rows<>206 then raise exception 'Truncated screenshot gallery'; end if;
 result:=monitoring_screenshot_page(auth_org(),'76000000-0000-0000-0000-000000000011',now()-interval '90 days',now()+interval '2 days');
 if (result->>'total')::int<>208 then raise exception 'History RLS or foreign scope bypass'; end if;
end $$;
reset role;
-- Parameter, permission and ACL tests use the same real helper/policies.
create function screenshot_expect_rejected(query text,expected text) returns void language plpgsql as $$
begin
 begin execute query; exception when others then if position(expected in sqlerrm)>0 then return; end if; raise; end;
 raise exception 'Expected rejection: %',expected;
end $$;
grant execute on function screenshot_expect_rejected(text,text) to authenticated;
set role authenticated;
select screenshot_expect_rejected($q$select monitoring_screenshot_page(auth_org(),'76000000-0000-0000-0000-000000000011',now(),now()+interval '1 day',null,null,49)$q$,'SCREENSHOT_PAGE_INVALID');
select screenshot_expect_rejected($q$select monitoring_screenshot_page(auth_org(),'76000000-0000-0000-0000-000000000011',now(),now()+interval '1 day',now(),null)$q$,'SCREENSHOT_PAGE_INVALID');
select screenshot_expect_rejected($q$select monitoring_screenshot_page(auth_org(),'76000000-0000-0000-0000-000000000011','-infinity',now())$q$,'SCREENSHOT_PAGE_INVALID');
select screenshot_expect_rejected($q$select monitoring_screenshot_page('76000000-0000-0000-0000-000000000002','76000000-0000-0000-0000-000000000011',now(),now()+interval '1 day')$q$,'SCREENSHOT_PAGE_FORBIDDEN');
reset role;
update user_permissions set allowed=false;
set role authenticated;
select screenshot_expect_rejected($q$select monitoring_screenshot_page(auth_org(),'76000000-0000-0000-0000-000000000011',now(),now()+interval '1 day')$q$,'SCREENSHOT_PAGE_FORBIDDEN');
reset role;
-- Own-only users cannot use the wide monitoring page, even on their own rows.
delete from user_permissions;
set role authenticated;
select screenshot_expect_rejected($q$select monitoring_screenshot_page(auth_org(),'76000000-0000-0000-0000-000000000011',now(),now()+interval '1 day')$q$,'SCREENSHOT_PAGE_FORBIDDEN');
reset role;
select set_config('request.jwt.claims','{"org":"76000000-0000-0000-0000-000000000001","user":"76000000-0000-0000-0000-000000000014","type":"client","app_metadata":{"user_type":"client"}}',false);
set role authenticated;
select screenshot_expect_rejected($q$select monitoring_screenshot_page(auth_org(),'76000000-0000-0000-0000-000000000011',now(),now()+interval '1 day')$q$,'SCREENSHOT_PAGE_FORBIDDEN');
reset role;
select set_config('request.jwt.claims','{"org":"76000000-0000-0000-0000-000000000001","user":"76000000-0000-0000-0000-000000000013","type":"admin","app_metadata":{"user_type":"admin"}}',false);
set role authenticated;
do $$ begin if (monitoring_screenshot_page(auth_org(),'76000000-0000-0000-0000-000000000011',date_trunc('day',now()),date_trunc('day',now())+interval '1 day')->>'total')::int<>206 then raise exception 'Owner denied'; end if; end $$;
reset role;
update memberships set status='inactive' where user_id='76000000-0000-0000-0000-000000000013';
set role authenticated;
select screenshot_expect_rejected($q$select monitoring_screenshot_page('76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000011',now(),now()+interval '1 day')$q$,'SCREENSHOT_PAGE_FORBIDDEN');
reset role;
do $$ begin
 if has_function_privilege('anon','monitoring_screenshot_page(uuid,uuid,timestamptz,timestamptz,timestamptz,text,int)','execute')
 or has_function_privilege('service_role','monitoring_screenshot_page(uuid,uuid,timestamptz,timestamptz,timestamptz,text,int)','execute')
 or (select prosecdef from pg_proc where oid='monitoring_screenshot_page(uuid,uuid,timestamptz,timestamptz,timestamptz,text,int)'::regprocedure)
 then raise exception 'Unsafe page function privileges'; end if;
end $$;
