\set ON_ERROR_STOP on
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;
\ir quota_fixture.sql
\ir ../../supabase/migrations/20260911055537_production_quota_enforcement.sql
\ir ../../supabase/migrations/20260911083056_production_delivery_write_lock.sql
\ir invitation_fixture.sql
alter table auth.users add column email_confirmed_at timestamptz default now(),add column deleted_at timestamptz,add column banned_until timestamptz;
alter table organizations add column owner_id uuid references admin_users(id),add column industry text,add column company_size text,add column country text,add column timezone text;
alter table admin_users add constraint owner_org_fk foreign key(organization_id) references organizations(id);
alter table billing_plans add column is_active boolean default true,add column trial_days integer default 0;
update billing_plans set trial_days=7 where code='professional';
alter table organization_subscriptions add column trial_start timestamptz;
create table email_verifications(id uuid primary key default gen_random_uuid(),email text,verified_at timestamptz,consumed_at timestamptz,code_hash text,expires_at timestamptz,attempts integer default 0,created_at timestamptz default now());
\ir ../../supabase/migrations/20260912043622_production_transactional_signup_recovery.sql
alter table email_verifications alter column signup_grant_hash set default repeat('a',64);
create function fail_signup_insert() returns trigger language plpgsql as $$ begin if current_setting('test.fail_table',true)=tg_table_name then raise exception 'Injected mandatory row failure'; end if; return new; end $$;
create trigger test_terms_failure before insert on terms_acceptances for each row execute function fail_signup_insert();
create trigger test_subscription_failure before insert on organization_subscriptions for each row execute function fail_signup_insert();
create trigger test_member_failure before insert on memberships for each row execute function fail_signup_insert();
do $$ declare a jsonb; b jsonb; c uuid:=gen_random_uuid(); sid uuid; authid uuid; orgid uuid; rowtype text; r jsonb; subscription jsonb;
begin
 perform expect_rejected(format('select claim_signup(''owner@example.test'',%L,''{"fullName":"Owner","company":"Company"}'',''professional'',''version'',repeat(''a'',64))',c),'SIGNUP_EMAIL_NOT_VERIFIED');
 insert into email_verifications(email,verified_at) values('owner@example.test',now());
 a:=claim_signup('Owner@Example.Test',c,'{"fullName":"Owner","company":"Company","password":"never-store","role":"owner"}','professional','version',repeat('a',64),'127.0.0.1');
 sid:=(a->>'id')::uuid; authid:=(a->>'auth_user_id')::uuid; orgid:=(a->>'organization_id')::uuid; subscription:=a->'subscription';
 if a->'details' ? 'password' or a->'details' ? 'role' then raise exception 'Untrusted signup fields stored'; end if;
 if exists(select 1 from organizations where id=orgid) then raise exception 'Reservation created partial organization'; end if;
 if exists(select 1 from email_verifications where email='owner@example.test' and consumed_at is null) then raise exception 'Verification not consumed'; end if;
 perform expect_rejected(format('select claim_signup(''owner@example.test'',%L,''{"fullName":"Other","company":"Other"}'',''enterprise'',''other'',repeat(''a'',64))',gen_random_uuid()),'SIGNUP_BUSY');
 perform release_signup_claim(sid,c);
 perform expect_rejected(format('select claim_signup(''owner@example.test'',%L,''{"fullName":"Other","company":"Other"}'',''enterprise'',''other'',repeat(''a'',64))',gen_random_uuid()),'SIGNUP_EMAIL_NOT_VERIFIED');
 insert into email_verifications(email,verified_at) values('owner@example.test',now()); c:=gen_random_uuid();
 b:=claim_signup('owner@example.test',c,'{"fullName":"Other","company":"Other"}','enterprise','other',repeat('a',64));
 if b->>'id'<>a->>'id' or b->>'auth_user_id'<>a->>'auth_user_id' or b->'subscription'<>subscription or b->>'terms_version'<>'version' or b->'details'<>a->'details' then raise exception 'Recovery changed reservation'; end if;
 perform expect_rejected(format('select finish_signup(%L,%L)',sid,c),'SIGNUP_AUTH_UNCONFIRMED');
 insert into auth.users(id,email,raw_app_meta_data) values(authid,'owner@example.test',jsonb_build_object('signup_id',sid,'app_user_id',a->>'profile_id','organization_id',orgid,'role','admin','user_type','admin'));
 perform expect_rejected(format('select finish_signup(%L,%L)',sid,c),'SIGNUP_AUTH_UNCONFIRMED');
 update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}','"owner"') where id=authid;
 foreach rowtype in array array['deleted_at','banned_until','email_confirmed_at'] loop
   if rowtype='email_confirmed_at' then update auth.users set email_confirmed_at=null where id=authid;
   else execute format('update auth.users set %I=now()+interval ''1 day'' where id=$1',rowtype) using authid; end if;
   perform expect_rejected(format('select finish_signup(%L,%L)',sid,c),'SIGNUP_AUTH_UNCONFIRMED');
   update auth.users set deleted_at=null,banned_until=null,email_confirmed_at=now() where id=authid;
 end loop;
 foreach rowtype in array array['terms_acceptances','organization_subscriptions','memberships'] loop
   perform set_config('test.fail_table',rowtype,true);
   perform expect_rejected(format('select finish_signup(%L,%L)',sid,c),'Injected mandatory row failure');
   if exists(select 1 from organizations where id=orgid) or exists(select 1 from admin_users where id=(a->>'profile_id')::uuid) then raise exception 'Mandatory failure left partial rows'; end if;
   if (select completed_at from app_private.signup_attempts where id=sid) is not null then raise exception 'Failed signup marked complete'; end if;
 end loop;
 perform set_config('test.fail_table','',true);
 perform release_signup_claim(sid,c);
 r:=claim_signup_recovery();
 if jsonb_array_length(r)<>1 then raise exception 'Auth-created reservation not recoverable'; end if;
 c:=(r->0->>'claim_id')::uuid;
 if jsonb_array_length(claim_signup_recovery())<>0 then raise exception 'Recovery claimed active lease'; end if;
 b:=finish_signup(sid,c);
 if b->>'success'<>'true' or b->'plan'->>'code'<>'professional' then raise exception 'Signup result mismatch'; end if;
 if not exists(select 1 from admin_users where id=(a->>'profile_id')::uuid and organization_id=orgid and auth_user_id=authid) then raise exception 'Typed linkage missing'; end if;
 if not exists(select 1 from memberships where organization_id=orgid and user_type='admin' and role='owner' and status='active') then raise exception 'Owner membership missing'; end if;
 if not exists(select 1 from terms_acceptances where organization_id=orgid and document_version='version' and ip='127.0.0.1') then raise exception 'Consent evidence missing'; end if;
 if finish_signup(sid,c)<>b then raise exception 'Idempotent finalization failed'; end if;
 if jsonb_array_length(claim_signup_recovery())<>0 then raise exception 'Completed reservation reclaimed'; end if;
 insert into email_verifications(email,verified_at) values('enterprise@example.test',now());
 b:=claim_signup('enterprise@example.test',gen_random_uuid(),'{"fullName":"New","company":"New"}','enterprise','version',repeat('a',64));
 if b->'subscription'->>'plan_code'<>'free' then raise exception 'Enterprise without trial granted'; end if;
 if has_function_privilege('authenticated','public.claim_signup(text,uuid,jsonb,text,text,text,inet)','execute') or has_table_privilege('authenticated','app_private.signup_attempts','select') then raise exception 'Reservation exposed'; end if;
end $$;

do $$ declare tbl text; a jsonb; sid uuid; uid uuid; c uuid:=gen_random_uuid();
begin
 foreach tbl in array array['developers','clients','memberships'] loop
   execute format('insert into public.%I(id,email,organization_id) values(gen_random_uuid(),''collision@example.test'',''00000000-0000-0000-0000-000000000002'')',tbl);
   insert into email_verifications(email,verified_at) values('collision@example.test',now());
   perform expect_rejected(format('select claim_signup(''collision@example.test'',%L,''{"fullName":"Owner","company":"Company"}'',''free'',''version'',repeat(''a'',64))',gen_random_uuid()),'SIGNUP_ACCOUNT_EXISTS');
   execute format('delete from public.%I where email=''collision@example.test''',tbl);
 end loop;
 insert into email_verifications(email,verified_at) values('disabled@example.test',now());
 a:=claim_signup('disabled@example.test',c,'{"fullName":"Owner","company":"Company"}','free','version',repeat('a',64));
 sid:=(a->>'id')::uuid; uid:=(a->>'auth_user_id')::uuid;
 insert into auth.users(id,email,raw_app_meta_data) values(uid,'disabled@example.test',jsonb_build_object('signup_id',sid,'app_user_id',a->>'profile_id','organization_id',a->>'organization_id','role','owner','user_type','admin'));
 perform release_signup_claim(sid,c);
 foreach tbl in array array['deleted_at','banned_until','email_confirmed_at'] loop
   if tbl='email_confirmed_at' then update auth.users set email_confirmed_at=null where id=uid;
   else execute format('update auth.users set %I=now()+interval ''1 day'' where id=$1',tbl) using uid; end if;
   if jsonb_array_length(claim_signup_recovery())<>0 then raise exception 'Disabled Auth selected for recovery'; end if;
   update auth.users set deleted_at=null,banned_until=null,email_confirmed_at=now() where id=uid;
 end loop;
end $$;

do $$ declare r jsonb; v uuid; i integer; a jsonb;
begin
 insert into email_verifications(email,code_hash,expires_at,verified_at,signup_grant_hash)
 values('proof@example.test',repeat('b',64),now()+interval '10 minutes',now(),null) returning id into v;
 -- A previous verified_at flag alone cannot mint a grant for arbitrary code.
 r:=verify_signup_code('proof@example.test',repeat('c',64),repeat('d',64));
 if (r->>'verified')::boolean or (select signup_grant_hash from email_verifications where id=v) is not null then raise exception 'Verified flag bypassed code proof'; end if;
 perform expect_rejected(format('select claim_signup(''proof@example.test'',%L,''{"fullName":"Owner","company":"Company"}'',''free'',''version'',repeat(''d'',64))',gen_random_uuid()),'SIGNUP_EMAIL_NOT_VERIFIED');
 r:=verify_signup_code('proof@example.test',repeat('b',64),repeat('d',64));
 if not (r->>'verified')::boolean then raise exception 'Correct code refused'; end if;
 perform expect_rejected(format('select claim_signup(''proof@example.test'',%L,''{"fullName":"Owner","company":"Company"}'',''free'',''version'',repeat(''e'',64))',gen_random_uuid()),'SIGNUP_EMAIL_NOT_VERIFIED');
 perform expect_rejected(format('select claim_signup(''different@example.test'',%L,''{"fullName":"Owner","company":"Company"}'',''free'',''version'',repeat(''d'',64))',gen_random_uuid()),'SIGNUP_EMAIL_NOT_VERIFIED');
 a:=claim_signup('proof@example.test',gen_random_uuid(),'{"fullName":"Owner","company":"Company"}','free','version',repeat('d',64));
 if a->>'id' is null then raise exception 'Valid claimant proof refused'; end if;
 if (verify_signup_code('proof@example.test',repeat('b',64),repeat('e',64))->>'verified')::boolean then raise exception 'Consumed code reissued grant'; end if;
 insert into email_verifications(email,code_hash,expires_at,signup_grant_hash) values('guesses@example.test',repeat('b',64),now()+interval '10 minutes',null);
 for i in 1..5 loop perform verify_signup_code('guesses@example.test',repeat('c',64),repeat('d',64)); end loop;
 if (verify_signup_code('guesses@example.test',repeat('b',64),repeat('d',64))->>'verified')::boolean then raise exception 'Guess cap bypassed'; end if;
 if has_function_privilege('authenticated','public.verify_signup_code(text,text,text)','execute') then raise exception 'Public grant minting authority'; end if;
end $$;
