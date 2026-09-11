\set ON_ERROR_STOP on
\ir notification_insert_authority.sql
\ir ../../supabase/migrations/20260911164338_production_server_notification_event_guard.sql
do $$ declare event_type text; n bigint; begin
 perform set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000001","app_user_id":"00000000-0000-0000-0000-000000000011","user_type":"developer"}}',true);
 foreach event_type in array array['proposal_submitted','client_approved','client_changes_requested','project_manager_assigned'] loop
  select count(*) into n from notifications where type=event_type;
  set local role authenticated;
  perform expect_notice_denied(jsonb_build_object('type',event_type));
  reset role;
  if (select count(*) from notifications where type=event_type)<>n then raise exception 'Browser forged authoritative event %',event_type; end if;
  set local role service_role;
  perform insert_notice(jsonb_build_object('type',event_type));
  reset role;
  if (select count(*) from notifications where type=event_type)<>n+1 then raise exception 'Trusted event % refused',event_type; end if;
 end loop;
 -- Existing browser-supported notices keep sender attribution and reference
 -- validation; this migration does not silently disable their current flows.
 foreach event_type in array array['info','warning','task_comment','project_assigned','task_status_changed','milestone_completed'] loop
  select count(*) into n from notifications where type=event_type;
  set local role authenticated;
  perform insert_notice(jsonb_build_object('type',event_type,'actor_id','00000000-0000-0000-0000-000000000012','actor_type','admin'));
  reset role;
  if (select count(*) from notifications where type=event_type)<>n+1 then raise exception 'Existing browser event % broken',event_type; end if;
  if not exists(select 1 from notifications where type=event_type and actor_id='00000000-0000-0000-0000-000000000011' and actor_type='developer') then raise exception 'Generic event actor attribution lost'; end if;
 end loop;
end $$;
