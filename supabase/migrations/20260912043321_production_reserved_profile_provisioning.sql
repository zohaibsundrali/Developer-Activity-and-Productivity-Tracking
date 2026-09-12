begin;
create table app_private.profile_provisioning (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 profile_id uuid not null, user_type text not null check(user_type in ('admin','developer','client')),
 role text not null, email text not null, auth_user_id uuid not null unique,
 completed_at timestamptz, created_at timestamptz not null default now(), next_attempt_at timestamptz not null default now(),
 unique(organization_id,profile_id,user_type)
);
alter table app_private.profile_provisioning enable row level security;
revoke all on app_private.profile_provisioning from public,anon,authenticated;

create function public.reserve_profile_provision(p_org uuid,p_profile uuid,p_type text,p_role text,p_email text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare rel text; profile jsonb; reservation app_private.profile_provisioning; existing_auth uuid; identity jsonb; changed int;
begin
 perform 1 from public.organizations where id=p_org for update;
 if not found or app_private.organization_deleting(p_org) then raise exception 'Organization unavailable' using errcode='42501'; end if;
 rel:=case p_type when 'admin' then 'admin_users' when 'developer' then 'developers' when 'client' then 'clients' end;
 if rel is null or public.role_rank(p_role) is null or p_email is null or btrim(p_email)='' or
   (p_type='client')<>(p_role='client') or (p_type='admin')<>(p_role in ('owner','admin')) then raise exception 'Invalid typed identity' using errcode='42501'; end if;
 execute format('select to_jsonb(p) from public.%I p where id=$1 and organization_id=$2 for update',rel) into profile using p_profile,p_org;
 if profile is null or lower(btrim(profile->>'email')) is distinct from lower(btrim(p_email)) then raise exception 'Profile mismatch' using errcode='42501'; end if;
 if exists(select 1 from memberships m where m.organization_id=p_org and m.user_id=p_profile and m.user_type=p_type and (m.role<>p_role or m.status<>'active' or lower(btrim(m.email)) is distinct from lower(btrim(p_email)))) then raise exception 'Membership mismatch' using errcode='42501'; end if;
 if exists(select 1 from memberships m where lower(btrim(m.email))=lower(btrim(p_email)) and (m.organization_id<>p_org or m.user_id<>p_profile or m.user_type<>p_type)) then raise exception 'Address identity conflict' using errcode='42501'; end if;
 select * into reservation from app_private.profile_provisioning where organization_id=p_org and profile_id=p_profile and user_type=p_type for update;
 existing_auth:=nullif(profile->>'auth_user_id','')::uuid;
 if found then
  if reservation.role<>p_role or reservation.email<>lower(btrim(p_email)) or existing_auth is distinct from reservation.auth_user_id then raise exception 'Reservation changed' using errcode='42501'; end if;
  return jsonb_build_object('reservationId',reservation.id,'authUserId',reservation.auth_user_id,'alreadyLinked',reservation.completed_at is not null);
 end if;
 if existing_auth is not null then
  select to_jsonb(u) into identity from auth.users u where id=existing_auth;
  if identity is null or identity->>'email_confirmed_at' is null or identity->>'deleted_at' is not null or (identity->>'banned_until')::timestamptz>now()
   or lower(btrim(identity->>'email')) is distinct from lower(btrim(p_email))
   or identity->'raw_app_meta_data'->>'organization_id' is distinct from p_org::text
   or identity->'raw_app_meta_data'->>'app_user_id' is distinct from p_profile::text
   or identity->'raw_app_meta_data'->>'user_type' is distinct from p_type
   or identity->'raw_app_meta_data'->>'role' is distinct from p_role then raise exception 'Existing Auth link requires review' using errcode='42501'; end if;
  return jsonb_build_object('authUserId',existing_auth,'alreadyLinked',true);
 end if;
 if exists(select 1 from auth.users where lower(btrim(email))=lower(btrim(p_email))) then raise exception 'Existing email identity requires explicit link repair' using errcode='42501'; end if;
 insert into app_private.profile_provisioning(organization_id,profile_id,user_type,role,email,auth_user_id)
 values(p_org,p_profile,p_type,p_role,lower(btrim(p_email)),gen_random_uuid()) returning * into reservation;
 -- Reserve the exact Auth ID before any provider call. It grants no access
 -- until that Auth identity exists and finish verifies its trusted metadata.
 execute format('update public.%I set auth_user_id=$1 where id=$2 and organization_id=$3 and auth_user_id is null',rel) using reservation.auth_user_id,p_profile,p_org;
 get diagnostics changed = row_count;
 if changed<>1 then raise exception 'Profile changed during reservation' using errcode='40001'; end if;
 return jsonb_build_object('reservationId',reservation.id,'authUserId',reservation.auth_user_id,'alreadyLinked',false);
end $$;

create function public.finish_profile_provision(p_org uuid,p_profile uuid,p_type text,p_role text,p_email text,p_auth uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare reservation jsonb; identity jsonb;
begin
 reservation:=public.reserve_profile_provision(p_org,p_profile,p_type,p_role,p_email);
 if reservation->>'authUserId' is distinct from p_auth::text then raise exception 'Reserved Auth mismatch' using errcode='42501'; end if;
 select to_jsonb(u) into identity from auth.users u where id=p_auth for share;
 if identity is null or identity->>'email_confirmed_at' is null or identity->>'deleted_at' is not null or (identity->>'banned_until')::timestamptz>now()
  or lower(btrim(identity->>'email')) is distinct from lower(btrim(p_email))
  or identity->'raw_app_meta_data'->>'organization_id' is distinct from p_org::text
  or identity->'raw_app_meta_data'->>'app_user_id' is distinct from p_profile::text
  or identity->'raw_app_meta_data'->>'user_type' is distinct from p_type
  or identity->'raw_app_meta_data'->>'role' is distinct from p_role
  or (not coalesce((reservation->>'alreadyLinked')::boolean,false) and identity->'raw_app_meta_data'->>'provisioning_id' is distinct from reservation->>'reservationId') then raise exception 'Auth identity mismatch' using errcode='42501'; end if;
 if exists(select 1 from (select id,organization_id,auth_user_id,'admin'::text kind from admin_users union all select id,organization_id,auth_user_id,'developer' from developers union all select id,organization_id,auth_user_id,'client' from clients) p where p.auth_user_id=p_auth and (p.id<>p_profile or p.organization_id<>p_org or p.kind<>p_type)) then raise exception 'Shared Auth identity' using errcode='42501'; end if;
 insert into public.memberships(organization_id,user_id,user_type,role,email,status)
 values(p_org,p_profile,p_type,p_role,lower(btrim(p_email)),'active')
 on conflict(organization_id,user_id,user_type) do nothing;
 update app_private.profile_provisioning set completed_at=coalesce(completed_at,now()) where organization_id=p_org and profile_id=p_profile and user_type=p_type and auth_user_id=p_auth;
 return true;
end $$;

-- An unfinished provider call may still create its reserved Auth account.
-- Deletion must wait for checked completion instead of snapshotting an absent
-- account and leaving a late-created credential behind.
create function app_private.guard_pending_profile_provision() returns trigger language plpgsql security definer set search_path=pg_catalog,app_private as $$
begin
 if exists(select 1 from app_private.profile_provisioning where organization_id=new.organization_id and completed_at is null) then raise exception 'PROVISIONING_PENDING: resolve saved sign-in setup before organization deletion' using errcode='55000'; end if;
 return new;
end $$;
create trigger aaa_pending_profile_provision before insert on app_private.organization_deletions for each row execute function app_private.guard_pending_profile_provision();
create function app_private.guard_pending_provision_profile() returns trigger language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare kind text:=case tg_table_name when 'admin_users' then 'admin' when 'developers' then 'developer' else 'client' end; pending app_private.profile_provisioning;
begin
 select * into pending from app_private.profile_provisioning where organization_id=old.organization_id and profile_id=old.id and user_type=kind and completed_at is null;
 if found and (tg_op='DELETE' or new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
   or new.email is distinct from old.email or new.auth_user_id is distinct from pending.auth_user_id) then
  raise exception 'PROVISIONING_PENDING: finish reserved sign-in setup before deleting or changing identity' using errcode='55000';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger aaa_pending_provision before update or delete on public.admin_users for each row execute function app_private.guard_pending_provision_profile();
create trigger aaa_pending_provision before update or delete on public.developers for each row execute function app_private.guard_pending_provision_profile();
create trigger aaa_pending_provision before update or delete on public.clients for each row execute function app_private.guard_pending_provision_profile();
revoke all on function app_private.guard_pending_provision_profile() from public,anon,authenticated;

create function public.claim_profile_provisions(p_limit integer default 10) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare result jsonb;
begin
 with candidates as (
  select id from app_private.profile_provisioning p where completed_at is null and next_attempt_at<=now()
    and not app_private.organization_deleting(p.organization_id)
  order by next_attempt_at,created_at limit greatest(1,least(coalesce(p_limit,10),25)) for update skip locked
 ), claimed as (
  update app_private.profile_provisioning p set next_attempt_at=now()+interval '5 minutes'
  from candidates c where p.id=c.id returning p.*
 ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
 return result;
end $$;
revoke all on function public.claim_profile_provisions(integer) from public,anon,authenticated;
grant execute on function public.claim_profile_provisions(integer) to service_role;
create function public.profile_provision_status(p_org uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,app_private as $$
 select coalesce(jsonb_agg(jsonb_build_object('profileId',profile_id,'userType',user_type,'role',role,'email',email,'status',case when completed_at is null then 'pending' else 'completed' end,'createdAt',created_at) order by created_at),'[]'::jsonb) from app_private.profile_provisioning where organization_id=p_org;
$$;
revoke all on function public.profile_provision_status(uuid) from public,anon,authenticated;
grant execute on function public.profile_provision_status(uuid) to service_role;
revoke all on function public.reserve_profile_provision(uuid,uuid,text,text,text),public.finish_profile_provision(uuid,uuid,text,text,text,uuid),app_private.guard_pending_profile_provision() from public,anon,authenticated;
grant execute on function public.reserve_profile_provision(uuid,uuid,text,text,text),public.finish_profile_provision(uuid,uuid,text,text,text,uuid) to service_role;
commit;
