-- Typed migration test, after typed_notification_fixture and migration.
do $$ begin
 if (select cardinality(recipient_keys) from notifications where title='ambiguous')<>0 then raise exception 'Ambiguous identity guessed'; end if;
 if (select count(*) from notification_recipients)<>6 then raise exception 'Backfill recipient count'; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000001","app_user_id":"00000000-0000-0000-0000-000000000011","user_type":"admin"}}',false);
do $$ begin
 if (select array_agg(title order by title) from notifications)<>array['admin','multi'] then raise exception 'Admin collision leak'; end if;
 if (select count(*) from notification_recipients)<>2 then raise exception 'Recipient table leak'; end if;
end $$;
insert into notification_preferences(organization_id,user_id,user_type,category,enabled) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','review',false);
select set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000001","app_user_id":"00000000-0000-0000-0000-000000000011","user_type":"developer"}}',false);
do $$ begin
 if (select array_agg(title) from notifications)<>array['developer'] then raise exception 'Developer collision leak'; end if;
 if exists(select 1 from notification_preferences) then raise exception 'Preference collision leak'; end if;
 begin insert into notification_preferences(organization_id,user_id,user_type,category,enabled) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','other',true); raise exception 'Forged preference succeeded'; exception when insufficient_privilege then null; end;
 begin insert into notification_recipients values('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','developer'); raise exception 'Forged recipient succeeded'; exception when insufficient_privilege then null; end;
end $$;
insert into notification_preferences(organization_id,user_id,user_type,category,enabled) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','developer','review',true);
reset role;
insert into notifications(organization_id,admin_id,admin_recipient_type,developer_id,category,title) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','00000000-0000-0000-0000-000000000011','review','mixed preference');
do $$ begin
 if (select recipient_keys from notifications where title='mixed preference')<>array['developer:00000000-0000-0000-0000-000000000011'] then raise exception 'One mute suppressed other recipient'; end if;
 begin insert into notifications(organization_id,admin_id) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011'); raise exception 'Ambiguous new address accepted'; exception when invalid_parameter_value then null; end;
 begin insert into notifications(organization_id,developer_id) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000014'); raise exception 'Cross tenant recipient accepted'; exception when invalid_parameter_value then null; end;
 begin insert into notifications(organization_id,developer_id) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000013'); raise exception 'Suspended recipient accepted'; exception when invalid_parameter_value then null; end;
 begin update notifications set recipient_keys=array['developer:00000000-0000-0000-0000-000000000011'] where title='admin'; raise exception 'Recipient rewrite accepted'; exception when insufficient_privilege then null; end;
end $$;
set role authenticated;
select set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000001","app_user_id":"00000000-0000-0000-0000-000000000012","user_type":"developer"}}',false);
do $$ begin
 if (select count(*) from notifications)<>3 then raise exception 'Manager lost admin or email addressed notifications'; end if;
end $$;
-- Server recomputes the key array; caller cannot add a colliding admin identity.
insert into notifications(organization_id,developer_id,recipient_keys,title) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012',array['admin:00000000-0000-0000-0000-000000000011'],'forged keys') returning title;
reset role;
do $$ begin
 if (select recipient_keys from notifications where title='forged keys')<>array['developer:00000000-0000-0000-0000-000000000012'] then raise exception 'Forged keys retained'; end if;
end $$;
