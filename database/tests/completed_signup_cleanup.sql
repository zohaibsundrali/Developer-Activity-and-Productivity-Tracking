\set ON_ERROR_STOP on
\ir transactional_signup_recovery.sql
\ir ../../supabase/migrations/20260912044958_production_completed_signup_cleanup.sql
create function fail_after_signup_cleanup() returns trigger language plpgsql as $$
begin
 if current_setting('test.fail_signup_cleanup',true)='yes' then raise exception 'Injected cleanup rollback'; end if;
 return old;
end $$;
create trigger zzz_signup_cleanup_failure after delete on organizations for each row execute function fail_after_signup_cleanup();
begin;
do $$ declare completed app_private.signup_attempts; pending_count integer; before_result jsonb; before_auth jsonb; begin
 select * into completed from app_private.signup_attempts where completed_at is not null order by created_at limit 1;
 if completed.id is null then raise exception 'Fixture has no completed signup'; end if;
 select count(*) into pending_count from app_private.signup_attempts where completed_at is null;
 if pending_count=0 then raise exception 'Fixture has no pending recovery to preserve'; end if;
 select to_jsonb(u) into before_auth from auth.users u where id=completed.auth_user_id;
 before_result:=finish_signup(completed.id,completed.claim_id);
 if before_result->>'success'<>'true' or finish_signup(completed.id,completed.claim_id)<>before_result then raise exception 'Active signup replay changed'; end if;
 if has_function_privilege('authenticated','app_private.cleanup_completed_signup()','execute') or has_function_privilege('service_role','app_private.cleanup_completed_signup()','execute') then raise exception 'Cleanup helper exposed'; end if;
 -- Satisfy the fixture's deliberate legacy NO ACTION profile/organization FK;
 -- production lifecycle teardown likewise removes dependent public profiles.
 update organizations set owner_id=null where id=completed.organization_id;
 delete from admin_users where id=completed.profile_id;
 perform set_config('test.fail_signup_cleanup','yes',true);
 perform expect_rejected(format('delete from organizations where id=%L',completed.organization_id),'Injected cleanup rollback');
 if not exists(select 1 from organizations where id=completed.organization_id) or not exists(select 1 from app_private.signup_attempts where id=completed.id) then raise exception 'Failed deletion lost organization or signup recovery data'; end if;
 perform set_config('test.fail_signup_cleanup','',true);
 delete from organizations where id=completed.organization_id;
 if exists(select 1 from app_private.signup_attempts where id=completed.id) then raise exception 'Completed signup PII survived organization deletion'; end if;
 if (select count(*) from app_private.signup_attempts where completed_at is null)<>pending_count then raise exception 'Pending recovery was deleted'; end if;
 if (select to_jsonb(u) from auth.users u where id=completed.auth_user_id) is distinct from before_auth then raise exception 'Cleanup changed an Auth account'; end if;
 perform expect_rejected(format('select finish_signup(%L,%L)',completed.id,completed.claim_id),'SIGNUP_UNAVAILABLE');
 -- Repeating an absent organization delete is harmless and cannot resurrect it.
 delete from organizations where id=completed.organization_id;
 if exists(select 1 from organizations where id=completed.organization_id) then raise exception 'Deleted organization resurrected'; end if;
end $$;
rollback;
