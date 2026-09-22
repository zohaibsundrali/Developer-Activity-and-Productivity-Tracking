-- Fresh isolated database only. Production migration, with injected write
-- failures to prove both operations roll back instead of leaving partial data.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create table clients(id uuid primary key, organization_id uuid not null, status text, email text);
create table memberships(organization_id uuid, user_id uuid, user_type text, status text);
create table projects(id uuid primary key, organization_id uuid not null);
create table project_clients(organization_id uuid, client_id uuid, project_id uuid);
create table support_threads(id uuid primary key default gen_random_uuid(), organization_id uuid, project_id uuid,
 client_id uuid, subject text, status text default 'open',last_message_at timestamptz default now(),created_at timestamptz default now());
create table support_messages(id uuid primary key default gen_random_uuid(),organization_id uuid,thread_id uuid references support_threads(id),
 sender_type text,sender_id uuid,sender_name text,body text,created_at timestamptz default now());
grant select,insert,update on all tables in schema public to service_role;
\ir ../../supabase/migrations/20260920174850_client_support_transactions.sql
create function test_support_failure() returns trigger language plpgsql as $$ begin
 if current_setting('test.support_failure',true)=TG_TABLE_NAME then raise exception 'INJECTED_FAILURE'; end if;
 return new;
end $$;
create trigger fail_message before insert on support_messages for each row execute function test_support_failure();
create trigger fail_thread_update before update on support_threads for each row execute function test_support_failure();
create function expect_failure(command text, expected text) returns void language plpgsql as $$ begin
 begin execute command; exception when others then
  if position(expected in sqlerrm)>0 then return; end if; raise;
 end;
 raise exception 'Expected error missing: %',expected;
end $$;
do $$
declare org uuid='aa000000-0000-0000-0000-000000000001'; client uuid='aa000000-0000-0000-0000-000000000002';
 project uuid='aa000000-0000-0000-0000-000000000003'; other_client uuid='aa000000-0000-0000-0000-000000000004';
 command text; reply text; result jsonb; thread uuid;
begin
 insert into clients values(client,org,'active','qa@example.invalid'),(other_client,org,'active','other@example.invalid');
 insert into memberships values(org,client,'client','active'),(org,other_client,'client','active');
 insert into projects values(project,org);
 command:=format('select create_client_support_thread(%L,%L,%L,''Test request'',''First message'')',org,client,project);
 perform expect_failure(command,'SUPPORT_FORBIDDEN');
 insert into project_clients values(org,client,project);
 perform expect_failure(format('select create_client_support_thread(%L,%L,%L,''Wrong tenant'',''Message'')',other_client,client,project),'SUPPORT_FORBIDDEN');
 perform set_config('test.support_failure','support_messages',true);
 perform expect_failure(command,'INJECTED_FAILURE');
 if exists(select 1 from support_threads) or exists(select 1 from support_messages) then raise exception 'Partial creation persisted'; end if;
 perform set_config('test.support_failure','',true);
 update memberships set status='revoked' where user_id=client;
 perform expect_failure(command,'SUPPORT_FORBIDDEN');
 update memberships set status='active',user_type='developer' where user_id=client;
 perform expect_failure(command,'SUPPORT_FORBIDDEN');
 update memberships set user_type='client' where user_id=client;
 set local role anon;
 perform expect_failure(command,'permission denied');
 reset role;
 set local role authenticated;
 perform expect_failure(command,'permission denied');
 reset role;
 set local role service_role;
 result:=create_client_support_thread(org,client,project,'Test request','First message');
 reset role;
 thread:=(result->'thread'->>'id')::uuid;
 if (select count(*) from support_threads)<>1 or (select count(*) from support_messages)<>1 then raise exception 'Creation missing records'; end if;
 reply:=format('select reply_client_support_thread(%L,%L,%L,''Follow up'')',org,client,thread);
 perform expect_failure(format('select reply_client_support_thread(%L,%L,%L,''Foreign reply'')',org,other_client,thread),'SUPPORT_NOT_FOUND');
 perform set_config('test.support_failure','support_threads',true);
 perform expect_failure(reply,'INJECTED_FAILURE');
 if (select count(*) from support_messages)<>1 then raise exception 'Reply persisted despite thread bump failure'; end if;
 perform set_config('test.support_failure','',true);
 set local role service_role;
 result:=reply_client_support_thread(org,client,thread,'Follow up');
 reset role;
 if (select count(*) from support_messages)<>2 then raise exception 'Reply missing'; end if;
 if result->'message'->>'sender_name'<>'qa@example.invalid' then raise exception 'Sender was not resolved from client profile'; end if;
 if (select last_message_at from support_threads where id=thread) is distinct from (result->'message'->>'created_at')::timestamptz then raise exception 'Thread activity did not match reply'; end if;
 raise notice 'PASS: atomic client support creation/reply, rollback, ownership, active typed membership and RPC privileges';
end $$;
