\set ON_ERROR_STOP on
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth;
create schema app_private;
create table auth.users(id uuid primary key);
create table public.invitations(id uuid primary key,status text,expires_at timestamptz);
create table app_private.invitation_attempts(invitation_id uuid primary key,claim_id uuid,auth_user_id uuid,completed_at timestamptz,lease_until timestamptz);
create table public.admin_users(auth_user_id uuid);
create table public.developers(auth_user_id uuid);
create table public.clients(auth_user_id uuid);
\ir ../../supabase/migrations/20260912035950_production_invitation_cleanup_confirmation.sql
do $$ declare i uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); t text;
begin
 insert into invitations values(i,'revoked',now()+interval '1 day');
 insert into app_private.invitation_attempts values(i,c,a,null,now()+interval '5 minutes');
 insert into auth.users values(a);
 begin perform finish_invitation_cleanup(i,c); raise exception 'Lost live account recovery'; exception when others then if sqlerrm<>'INVITATION_CLEANUP_UNCONFIRMED' then raise; end if; end;
 delete from auth.users where id=a;
 foreach t in array array['admin_users','developers','clients'] loop
  execute format('insert into public.%I values($1)',t) using a;
  begin perform finish_invitation_cleanup(i,c); raise exception 'Lost linked account recovery'; exception when others then if sqlerrm<>'INVITATION_CLEANUP_UNCONFIRMED' then raise; end if; end;
  execute format('delete from public.%I',t);
 end loop;
 begin perform finish_invitation_cleanup(i,gen_random_uuid()); raise exception 'Stale claim succeeded'; exception when others then if sqlerrm<>'INVITATION_CLEANUP_UNAVAILABLE' then raise; end if; end;
 update invitations set status='accepted' where id=i;
 begin perform finish_invitation_cleanup(i,c); raise exception 'Accepted cleanup succeeded'; exception when others then if sqlerrm<>'INVITATION_CLEANUP_UNAVAILABLE' then raise; end if; end;
 update invitations set status='revoked' where id=i;
 update app_private.invitation_attempts set lease_until=now()-interval '1 second';
 begin perform finish_invitation_cleanup(i,c); raise exception 'Expired lease succeeded'; exception when others then if sqlerrm<>'INVITATION_CLEANUP_UNAVAILABLE' then raise; end if; end;
 update app_private.invitation_attempts set lease_until=now()+interval '5 minutes';
 perform finish_invitation_cleanup(i,c);
 if exists(select 1 from app_private.invitation_attempts) then raise exception 'Confirmed cleanup retained attempt'; end if;
 perform finish_invitation_cleanup(i,c);
 if has_function_privilege('authenticated','public.finish_invitation_cleanup(uuid,uuid)','execute') or has_function_privilege('anon','public.finish_invitation_cleanup(uuid,uuid)','execute') then raise exception 'Public cleanup authority'; end if;
end $$;
