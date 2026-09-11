\ir task_authorization_fixture.sql
\ir ../../supabase/migrations/20260911100211_production_task_authorization.sql
\ir ../../supabase/migrations/20260911105140_production_task_visibility_permission.sql
create function test_visibility_denied(command text) returns void language plpgsql as $$ begin
 begin execute command; exception when insufficient_privilege then return; end;
 raise exception 'Expected field denial: %',command;
end $$;
begin;
do $$ declare org uuid:=gen_random_uuid(); person uuid:=gen_random_uuid(); colleague uuid:=gen_random_uuid();
 project uuid:=gen_random_uuid(); task uuid:=gen_random_uuid(); hidden uuid:=gen_random_uuid(); changed int;
begin
 insert into memberships values(org,person,'developer','developer','active'),(org,colleague,'developer','developer','active');
 insert into projects values(project,org,colleague,true,'approved');
 insert into developer_tasks(id,organization_id,project_id,developer_id) values(task,org,project,person),(hidden,org,project,colleague);
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',person,'type','developer',
 'app_metadata',jsonb_build_object('organization_id',org,'app_user_id',person,'user_type','developer'))::text,true);
 -- A specific grant works even when the contributor's ordinary update is denied.
 insert into user_permissions values(person,'developer','task.set_client_visibility',true),(person,'developer','task.update_own',false);
 set local role authenticated;
 update developer_tasks set client_visible=true;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Visibility bulk update exposed hidden tasks or blocked allowed task'; end if;
 perform test_visibility_denied(format('update developer_tasks set client_visible=false,task_title=''forged'' where id=%L',task));
 perform test_visibility_denied(format('update developer_tasks set status=''in_progress'' where id=%L',task));
 update developer_tasks set client_visible=true where id=hidden;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Visibility grant exposed hidden task'; end if;
 reset role;
 -- Typed grant cannot be borrowed by an Admin UUID collision.
 insert into memberships values(org,person,'admin','qa','active');
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',person,'type','admin',
 'app_metadata',jsonb_build_object('organization_id',org,'app_user_id',person,'user_type','admin'))::text,true);
 set local role authenticated;
 update developer_tasks set client_visible=false where id=task;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Typed visibility grant collision'; end if;
 reset role;
 -- Owner default works; explicit deny overrides broad management.
 update memberships set role='owner' where user_id=person and user_type='admin';
 set local role authenticated;
 update developer_tasks set client_visible=false where id=task;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Owner default blocked'; end if;
 reset role;
 insert into user_permissions values(person,'admin','task.set_client_visibility',false);
 set local role authenticated;
 perform test_visibility_denied(format('update developer_tasks set client_visible=true where id=%L',task));
 perform test_visibility_denied(format('insert into developer_tasks(organization_id,project_id,client_visible) values(%L,%L,true)',org,project));
 update developer_tasks set task_title='Legitimate edit' where id=task;
 reset role;
 update memberships set role='team_lead' where user_id=person and user_type='admin';
 delete from user_permissions where user_type='admin';
 set local role authenticated;
 perform test_visibility_denied(format('insert into developer_tasks(organization_id,project_id,client_visible) values(%L,%L,true)',org,project));
 reset role;
 update memberships set status='suspended' where user_id=person;
 set local role authenticated;
 update developer_tasks set client_visible=true where id=task;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Suspended publisher accepted'; end if;
 reset role;
 set local role service_role;
 update developer_tasks set client_visible=true where id=task;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Trusted workflow blocked'; end if;
 reset role;
end $$;
rollback;
