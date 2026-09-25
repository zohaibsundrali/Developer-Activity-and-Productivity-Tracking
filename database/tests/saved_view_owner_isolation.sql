do $$ begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
end $$;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('test.claims')::jsonb $$;
create function auth_org() returns uuid language sql stable as $$ select (auth.jwt()->>'org')::uuid $$;
create function auth_app_user_id() returns uuid language sql stable as $$ select (auth.jwt()->>'id')::uuid $$;
create function auth_is_client() returns boolean language sql stable as $$ select auth.jwt()->'app_metadata'->>'user_type'='client' $$;
create table memberships(organization_id uuid,user_id uuid,user_type text);
create table saved_views(id uuid primary key default gen_random_uuid(),organization_id uuid,user_id uuid,project_id uuid,created_at timestamptz default now(),name text,is_shared boolean default false);
grant usage on schema auth to authenticated;
grant select,insert,update,delete on saved_views to authenticated;
alter table saved_views enable row level security;
create policy org_isolation on saved_views to authenticated using(organization_id=auth_org() and not auth_is_client()) with check(organization_id=auth_org() and not auth_is_client());
insert into memberships values('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','admin'),('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','admin'),('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','developer');
insert into saved_views(organization_id,user_id,name) select distinct organization_id,user_id,'legacy' from memberships;
\ir ../../supabase/migrations/20260925074540_saved_view_owner_isolation.sql
create function login_saved(org uuid,actor uuid,kind text) returns void language sql as $$ select set_config('test.claims',jsonb_build_object('org',org,'id',actor,'app_metadata',jsonb_build_object('user_type',kind))::text,true) $$;
create function saved_denied(command text) returns void language plpgsql as $$ begin
 begin execute command; exception when insufficient_privilege then return; end;
 raise exception 'Expected ownership denial: %',command;
end $$;
begin;
do $$ declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); personal uuid; shared uuid; n int;
begin
 if (select user_type from saved_views where user_id='10000000-0000-0000-0000-000000000002') is distinct from 'admin' then raise exception 'Unambiguous legacy owner not backfilled'; end if;
 if (select user_type from saved_views where user_id='10000000-0000-0000-0000-000000000003') is not null then raise exception 'Ambiguous legacy ownership guessed'; end if;
 perform login_saved(org,actor,'admin'); set local role authenticated;
 insert into saved_views(organization_id,name) values(org,'personal') returning id into personal;
 insert into saved_views(organization_id,name,is_shared) values(org,'shared',true) returning id into shared;
 if (select count(*) from saved_views)<>2 then raise exception 'Owner cannot see own views'; end if;
 perform saved_denied(format('update saved_views set user_id=%L where id=%L',staff,personal));
 perform saved_denied(format('insert into saved_views(organization_id,user_id,name) values(%L,%L,''spoof'')',org,staff));
 -- Same UUID, different profile type must not inherit ownership.
 perform login_saved(org,actor,'developer');
 if exists(select 1 from saved_views where id=personal) then raise exception 'Typed identity leak'; end if;
 if not exists(select 1 from saved_views where id=shared) then raise exception 'Shared view unavailable'; end if;
 update saved_views set name='stolen' where id=shared;get diagnostics n=row_count;if n<>0 then raise exception 'Shared reader can update';end if;
 delete from saved_views where id=shared;get diagnostics n=row_count;if n<>0 then raise exception 'Shared reader can delete';end if;
 perform login_saved(org,staff,'developer');
 if exists(select 1 from saved_views where id=personal) then raise exception 'Staff private-view leak'; end if;
 perform login_saved(gen_random_uuid(),actor,'admin');
 if exists(select 1 from saved_views) then raise exception 'Tenant leak'; end if;
 perform login_saved(org,actor,'client');
 if exists(select 1 from saved_views) then raise exception 'Client leak'; end if;
 perform login_saved(org,actor,'admin');
 update saved_views set name='renamed' where id=personal;get diagnostics n=row_count;if n<>1 then raise exception 'Owner update failed';end if;
 delete from saved_views where id in(personal,shared);get diagnostics n=row_count;if n<>2 then raise exception 'Owner delete failed';end if;
 reset role;
end $$;
rollback;
