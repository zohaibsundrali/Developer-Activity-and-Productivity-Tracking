do $$ begin
 if (select count(*) from notification_recipients r join notifications n on n.id=r.notification_id where n.title='multi' and r.read and r.read_at='2026-01-01T01:00:00Z')<>2 then raise exception 'Legacy shared state not preserved'; end if;
 if (select r.dismissed_at from notification_recipients r join notifications n on n.id=r.notification_id where n.title='manager email')<>'2026-01-02T01:00:00Z' then raise exception 'Legacy dismissal lost'; end if;
end $$;
insert into notifications(id,organization_id,admin_id,admin_recipient_type,developer_id,title,category) values
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','00000000-0000-0000-0000-000000000011','shared fresh','comment'),
('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','00000000-0000-0000-0000-000000000011','other category','deadline');
set role authenticated;
select set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000001","app_user_id":"00000000-0000-0000-0000-000000000011","user_type":"admin"}}',false);
select set_notification_state('20000000-0000-0000-0000-000000000001','read');
do $$ declare stamp timestamptz; begin
 select read_at into stamp from notification_inbox where title='shared fresh';
 if stamp is null then raise exception 'Read timestamp absent'; end if;
 perform set_notification_state('20000000-0000-0000-0000-000000000001','read');
 if (select read_at from notification_inbox where title='shared fresh')<>stamp then raise exception 'Retry changed read timestamp'; end if;
 perform set_notification_state('20000000-0000-0000-0000-000000000001','dismiss');
 select dismissed_at into stamp from notification_inbox where title='shared fresh';
 perform set_notification_state('20000000-0000-0000-0000-000000000001','dismiss');
 if (select dismissed_at from notification_inbox where title='shared fresh')<>stamp then raise exception 'Retry changed dismissal'; end if;
 begin update notifications set read=true where id='20000000-0000-0000-0000-000000000001'; raise exception 'Shared row write allowed'; exception when insufficient_privilege then null; end;
 begin update notification_recipients set user_type='developer' where notification_id='20000000-0000-0000-0000-000000000001'; raise exception 'Recipient rewrite allowed'; exception when insufficient_privilege then null; end;
 begin perform set_notification_state('10000000-0000-0000-0000-000000000004','read'); raise exception 'Foreign recipient marked read'; exception when no_data_found then null; end;
end $$;
select set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000001","app_user_id":"00000000-0000-0000-0000-000000000011","user_type":"developer"}}',false);
do $$ begin
 if not exists(select 1 from notification_inbox where title='shared fresh' and not read and read_at is null and dismissed_at is null) then raise exception 'Other recipient state changed'; end if;
 if (select count(*) from notification_inbox where title='shared fresh')<>1 then raise exception 'View leaked other recipient state'; end if;
 if public.mark_notification_inbox_read('comment')<>1 then raise exception 'Category mark count wrong'; end if;
 if exists(select 1 from notification_inbox where title='other category' and read) then raise exception 'Category mark affected unrelated category'; end if;
 if public.mark_notification_inbox_read('comment')<>0 then raise exception 'Mark all retry not idempotent'; end if;
 perform set_notification_state('20000000-0000-0000-0000-000000000001','unread');
 if not exists(select 1 from notification_inbox where title='shared fresh' and not read and read_at is null) then raise exception 'Unread state not cleared'; end if;
 update notification_recipients set read=true,read_at='2000-01-01' where notification_id='20000000-0000-0000-0000-000000000001';
 if not exists(select 1 from notification_inbox where title='shared fresh' and read_at>now()-interval '1 minute') then raise exception 'Caller backdated read timestamp'; end if;
end $$;
select set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","app_user_id":"00000000-0000-0000-0000-000000000011","user_type":"developer"}}',false);
do $$ begin
 if exists(select 1 from notification_inbox) then raise exception 'Cross organization inbox leak'; end if;
 begin perform set_notification_state('20000000-0000-0000-0000-000000000001','read'); raise exception 'Cross organization mutation'; exception when no_data_found then null; end;
end $$;
reset role;
-- Preferences still filter recipients before insertion, and INSERT RETURNING
-- still returns the notification independently of the AFTER-trigger state rows.
insert into notification_preferences(organization_id,user_id,user_type,category,enabled) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','status',false);
insert into notifications(organization_id,admin_id,admin_recipient_type,developer_id,title,category,read,read_at,dismissed_at) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','00000000-0000-0000-0000-000000000011','filtered recipient','status',true,now(),now()) returning id;
do $$ begin
 if (select count(*) from notification_recipients r join notifications n on n.id=r.notification_id where n.title='filtered recipient')<>1 then raise exception 'Preference filter regressed'; end if;
 if exists(select 1 from notification_recipients r join notifications n on n.id=r.notification_id where n.title='filtered recipient' and (r.read or r.read_at is not null or r.dismissed_at is not null)) then raise exception 'New state not initialized'; end if;
end $$;
