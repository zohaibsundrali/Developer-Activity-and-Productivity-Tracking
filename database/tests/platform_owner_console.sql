\set ON_ERROR_STOP on
\ir workspace_lifecycle_integration.sql
-- Add reporting columns absent from the deliberately minimal lifecycle fixture.
alter table auth.sessions add column not_after timestamptz;
alter table organizations add column created_at timestamptz default now();
alter table organization_subscriptions add column current_period_end timestamptz,add column cancel_at_period_end boolean default false,add column last_payment_status text;
create table billing_invoices(id uuid primary key default gen_random_uuid(),organization_id uuid,currency text,status text,amount_paid_cents bigint,amount_due_cents bigint,created_at timestamptz default now());
create table tracker_devices(id uuid primary key default gen_random_uuid(),organization_id uuid);
\ir ../../supabase/migrations/20260920105039_platform_owner_console.sql

do $$
declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); other_session uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); profile uuid:=gen_random_uuid(); job uuid; result jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(uid,'platform@example.test',now(),'{}'),(other,'outsider@example.test',now(),'{"role":"owner"}');
 insert into auth.sessions(id,user_id) values(sid,uid),(other_session,other);
 if platform_owner_access(uid,sid) then raise exception 'Unregistered account authorized'; end if;
 insert into app_private.platform_owners(auth_user_id) values(uid);
 if not platform_owner_access(uid,sid) then raise exception 'Registered owner denied'; end if;
 update auth.sessions set not_after=now()-interval '1 minute' where id=sid;
 if platform_owner_access(uid,sid) then raise exception 'Expired session authorized';end if;
 update auth.sessions set not_after=null where id=sid;
 if platform_owner_access(uid,other_session) or platform_owner_access(other,sid) or platform_owner_access(uid,gen_random_uuid()) then raise exception 'Session binding failed'; end if;
 update auth.users set banned_until=now()+interval '1 day' where id=uid;
 if platform_owner_access(uid,sid) then raise exception 'Banned owner authorized'; end if;
 update auth.users set banned_until=null where id=uid;
 update auth.users set email_confirmed_at=null where id=uid;
 if platform_owner_access(uid,sid) then raise exception 'Unverified owner authorized'; end if;
 update auth.users set email_confirmed_at=now() where id=uid;
 if has_function_privilege('authenticated','public.platform_overview(uuid,uuid)','EXECUTE') or has_function_privilege('anon','public.platform_start_deletion(uuid,uuid,uuid,text,text,text)','EXECUTE') or has_table_privilege('authenticated','app_private.platform_owners','SELECT') then raise exception 'Client access leaked'; end if;
 begin perform platform_overview(other,other_session);raise exception 'Unauthorized overview succeeded'; exception when insufficient_privilege then null;end;
 insert into organizations(id,name,timezone) values(org,'Platform test workspace','UTC');
 insert into admin_users(id,organization_id,auth_user_id,email) values(profile,org,uid,'platform@example.test');
 insert into memberships(organization_id,user_id,user_type,role,status) values(org,profile,'admin','owner','active');
 insert into billing_invoices(organization_id,currency,status,amount_paid_cents) values(org,'usd','paid',500),(org,'eur','paid',700),(org,'usd','open',900);
 result:=platform_overview(uid,sid);
 if (result->>'organizations')::bigint<>(select count(*) from organizations) then raise exception 'Totals incorrect';end if;
 if jsonb_array_length(result->'growth')<>6 then raise exception 'Growth series incomplete';end if;
 if not exists(select 1 from jsonb_array_elements(result->'revenue') r where r->>'currency'='USD' and (r->>'paid_cents')::int=500) then raise exception 'Paid invoice totals incorrect';end if;
 if jsonb_array_length(result->'revenue')<>2 then raise exception 'Currencies mixed';end if;
 result:=platform_organizations(uid,sid,'Platform test',1);
 if (result->>'total')::int<>1 then raise exception 'Search incorrect';end if;
 if (platform_organizations(uid,sid,'%',1)->>'total')::int<>0 then raise exception 'Search wildcard was not literal';end if;
 insert into organizations(id,name,timezone) select gen_random_uuid(),'Pagination fixture '||n,'UTC' from generate_series(1,21) n;
 result:=platform_organizations(uid,sid,'Pagination fixture',2);
 if (result->>'total')::int<>21 or jsonb_array_length(result->'items')<>1 then raise exception 'Pagination counts incorrect';end if;
 if platform_organization_detail(uid,sid,gen_random_uuid()) is not null then raise exception 'Missing org fabricated';end if;
 begin perform platform_start_deletion(uid,sid,org,'Wrong name','Test removal reason',repeat('a',64));raise exception 'Wrong name accepted';exception when invalid_parameter_value then null;end;
 set local role service_role;
 job:=platform_start_deletion(uid,sid,org,'Platform test workspace','Test removal reason',repeat('a',64));
 reset role;
 if not exists(select 1 from app_private.organization_deletions where id=job and actor_id=uid and actor_type='platform') then raise exception 'Real platform actor missing';end if;
 if not exists(select 1 from app_private.organization_deletion_items where job_id=job and kind='auth' and resource_id=uid::text and status='retained') then raise exception 'Platform login not retained';end if;
 if not exists(select 1 from app_private.platform_audit where actor_id=uid and organization_id=org) then raise exception 'Deletion audit missing';end if;
 if not platform_retry_deletion(uid,sid,org) then raise exception 'Pending cleanup cannot be retried';end if;
 delete from auth.sessions where id=sid;
 if platform_owner_access(uid,sid) then raise exception 'Revoked session authorized';end if;
end $$;
select 'platform owner console integration passed' as result;
