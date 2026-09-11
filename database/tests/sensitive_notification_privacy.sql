\set ON_ERROR_STOP on
-- Reuse the complete isolated task/inbox policy chain; this fixture adds only
-- signal/billing tests and proves policies compose with prior task privacy.
\ir task_notification_privacy.sql
alter table memberships add column reports_to text;
\ir ../../supabase/migrations/20260911134600_production_sensitive_notification_privacy.sql
insert into memberships(organization_id,user_id,user_type,email,status,role,reports_to) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000031','developer','lead@example.test','active','manager',null),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000032','developer','report@example.test','active','developer','00000000-0000-0000-0000-000000000031');
insert into notifications(organization_id,developer_id,type,category,title,message,metadata) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000031','signal','signal','Sensitive person signal','Private tracked hours',
 '{"kind":"activity_drop","subject":{"type":"person","id":"report@example.test"},"metric":{"value":1,"baseline":40}}');
select privacy_actor('developer','00000000-0000-0000-0000-000000000031');
set role authenticated;
do $$begin if (select count(*) from notification_inbox where title='Sensitive person signal')<>1 then raise exception 'Current report notice missing'; end if; end$$;
reset role;
update memberships set reports_to=null where user_id='00000000-0000-0000-0000-000000000032';
set role authenticated;
do $$begin if exists(select 1 from notification_inbox where title='Sensitive person signal') then raise exception 'Former report signal still readable'; end if; end$$;
reset role;
update memberships set reports_to='00000000-0000-0000-0000-000000000031' where user_id='00000000-0000-0000-0000-000000000032';
insert into user_permissions select id,'signal.view',false from memberships where user_id='00000000-0000-0000-0000-000000000031';
set role authenticated;
do $$begin if exists(select 1 from notifications where title='Sensitive person signal') then raise exception 'Denied signal still readable'; end if; end$$;
reset role;
update user_permissions set allowed=true where permission_key='signal.view';
update memberships set role='employee' where user_id='00000000-0000-0000-0000-000000000031';
set role authenticated;
do $$begin if (select count(*) from notifications where title='Sensitive person signal')<>1 then raise exception 'Explicit signal grant ignored'; end if; end$$;
reset role;
insert into memberships(organization_id,user_id,user_type,email,status,role) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000031','admin','otherlead@example.test','suspended','manager');
set role authenticated;
do $$begin if exists(select 1 from notifications where title='Sensitive person signal') then raise exception 'Ambiguous historical manager identity authorized'; end if; end$$;
reset role;
update memberships set reports_to='lead@example.test' where user_id='00000000-0000-0000-0000-000000000032';
set role authenticated;
do $$begin if (select count(*) from notifications where title='Sensitive person signal')<>1 then raise exception 'Unique legacy manager email lost'; end if; end$$;
reset role;
insert into notifications(organization_id,admin_id,admin_recipient_type,type,category,title,metadata) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','trial_reminder','billing','Private billing reminder',null),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','signal','signal','Private plan pressure','{"kind":"plan_pressure","subject":{"type":"plan","id":"users"}}');
select privacy_actor('admin','00000000-0000-0000-0000-000000000011');
set role authenticated;
do $$begin if (select count(*) from notification_inbox where title like 'Private %')<>2 then raise exception 'Allowed billing missing'; end if; end$$;
reset role;
insert into user_permissions select id,'billing.view',false from memberships where user_id='00000000-0000-0000-0000-000000000011' and user_type='admin';
set role authenticated;
do $$begin if exists(select 1 from notification_inbox where title like 'Private %') then raise exception 'Billing denial leaked reminder or pressure'; end if; end$$;
reset role;
update user_permissions set allowed=true where permission_key='billing.view';
insert into user_permissions select id,'signal.view',false from memberships where user_id='00000000-0000-0000-0000-000000000011' and user_type='admin';
set role authenticated;
do $$begin if exists(select 1 from notifications where title='Private plan pressure') or not exists(select 1 from notifications where title='Private billing reminder') then raise exception 'Signal and billing permissions conflated'; end if; end$$;
reset role;
