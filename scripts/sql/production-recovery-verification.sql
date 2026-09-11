-- Read-only schema checks after SQL Editor recovery. PRESENT proves existence,
-- not that the complete migration/function body or live workflow was verified.
with expected(kind, object_name) as (values
 ('schema','private'),
 ('table','public.notification_recipients'),
 ('view','public.notification_inbox'),
 ('table','app_private.storage_usage'),
 ('column','projects.manager_type'),
 ('column','projects.created_by_type'),
 ('column','notifications.recipient_keys'),
 ('column','notification_recipients.read'),
 ('function','account_storage_object'),
 ('function','guard_project_typed_attribution'),
 ('function','notify_task_assignment_transaction'),
 ('trigger','projects.delivery_write_lock'),
 ('trigger','developer_tasks.delivery_write_lock')
)
select kind, object_name,
 case when case kind
  when 'schema' then exists(select 1 from pg_namespace n where n.nspname=object_name)
  when 'table' then to_regclass(object_name) is not null
  when 'view' then to_regclass(object_name) is not null
  when 'column' then exists(select 1 from information_schema.columns c where c.table_schema='public'
   and c.table_name=split_part(object_name,'.',1) and c.column_name=split_part(object_name,'.',2))
  when 'function' then exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','private','app_private') and p.proname=object_name)
  when 'trigger' then exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname=split_part(object_name,'.',1) and t.tgname=split_part(object_name,'.',2)
    and not t.tgisinternal and t.tgenabled in ('O','A'))
  else false end then 'PRESENT' else 'MISSING_OR_DISABLED' end as status
from expected order by kind,object_name;
