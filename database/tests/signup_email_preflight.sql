\set ON_ERROR_STOP on
\ir transactional_signup_recovery.sql
\ir ../../supabase/migrations/20260918072723_signup_email_preflight.sql

do $$ declare tbl text; c uuid:=gen_random_uuid(); a jsonb;
begin
 if signup_email_status('brandnew@example.test')<>'available' then raise exception 'New email blocked'; end if;
 if signup_email_status('  OWNER@EXAMPLE.TEST  ')<>'admin_exists' then raise exception 'Existing admin not detected'; end if;
 insert into admin_users(id, email, company) values(gen_random_uuid(),'  Odd.*_+%Name@Example.test  ','Test');
 if signup_email_status('odd.*_+%name@example.test')<>'admin_exists' then raise exception 'Literal/trimmed admin email mismatch'; end if;
 if signup_email_status('odd.xxxname@example.test')<>'available' then raise exception 'Email interpreted as pattern'; end if;
 foreach tbl in array array['developers','clients','memberships'] loop
  execute format('insert into public.%I(id,email,organization_id) values(gen_random_uuid(),''preflight-collision@example.test'',''00000000-0000-0000-0000-000000000002'')',tbl);
  if signup_email_status('preflight-collision@example.test')<>'identity_exists' then raise exception 'Missed identity in %',tbl; end if;
  execute format('delete from public.%I where email=''preflight-collision@example.test''',tbl);
 end loop;
 insert into auth.users(id,email) values(gen_random_uuid(),'auth-only@example.test');
 if signup_email_status('auth-only@example.test')<>'identity_exists' then raise exception 'Auth-only collision missed'; end if;
 insert into email_verifications(email,verified_at) values('resume-preflight@example.test',now());
 a:=claim_signup('resume-preflight@example.test',c,'{"fullName":"Owner","company":"Company"}','free','version',repeat('a',64));
 insert into auth.users(id,email) values((a->>'auth_user_id')::uuid,'resume-preflight@example.test');
 if signup_email_status('resume-preflight@example.test')<>'resumable' then raise exception 'Recovery blocked by own auth identity'; end if;
 if has_function_privilege('anon','public.signup_email_status(text)','execute') or has_function_privilege('authenticated','public.signup_email_status(text)','execute') then raise exception 'Public identity lookup exposed'; end if;
 if not has_function_privilege('service_role','public.signup_email_status(text)','execute') then raise exception 'Server lookup blocked'; end if;
 perform expect_rejected('select signup_email_status(''invalid'')','SIGNUP_INVALID');
end $$;
set role service_role;
select public.signup_email_status('owner@example.test')='admin_exists' as server_lookup_works;
reset role;
