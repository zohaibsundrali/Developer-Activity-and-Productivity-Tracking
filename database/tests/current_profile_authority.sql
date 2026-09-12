\set ON_ERROR_STOP on
\ir automation_retention_deletion_integration.sql
\ir ../../supabase/migrations/20260912035637_production_current_profile_authority.sql
-- Exercise the real tenant boundary using identical profile IDs in all three
-- identity tables; only the profile type and current Auth link may authorize.
begin;
do $$ declare org uuid:='98000000-0000-0000-0000-000000000001'; app uuid:='98000000-0000-0000-0000-000000000011'; uid uuid:='98000000-0000-0000-0000-000000000091'; kind text; rel text; role_name text; begin
 insert into organizations(id,name) values(org,'Profile authority');
 insert into admin_users values(app,org,uid);
 insert into developers values(app,org,uid);
 insert into clients values(app,org,uid);
 insert into auth.users(id,raw_app_meta_data) values(uid,'{}');
 foreach kind in array array['admin','developer','client'] loop
  role_name:=case when kind='admin' then 'owner' when kind='client' then 'client' else 'developer' end;
  rel:=case when kind='admin' then 'admin_users' when kind='client' then 'clients' else 'developers' end;
  insert into memberships(organization_id,user_id,user_type,role,status) values(org,app,kind,role_name,'active');
  update auth.users set raw_app_meta_data=jsonb_build_object('organization_id',org,'app_user_id',app,'user_type',kind,'role',role_name) where id=uid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'app_metadata',jsonb_build_object('organization_id',org,'app_user_id',app,'user_type',kind,'role',role_name))::text,true);
  set local role authenticated;
  if auth_org() is distinct from org or auth_role() is distinct from role_name then raise exception 'Valid typed profile refused: %',kind; end if;
  reset role;
  -- A lower numeric claim rank can still hold unique permissions. No old
  -- role, explicit override, or self-scope may survive inconsistent stores.
  update memberships set role='manager' where organization_id=org and user_type=kind;
  set local role authenticated;
  if auth_org() is not null or auth_role() is not null then raise exception 'Stale role retained access: %',kind; end if;
  reset role;
  update memberships set role=role_name where organization_id=org and user_type=kind;
  execute format('update %I set auth_user_id=null where id=$1',rel) using app;
  set local role authenticated;
  if auth_org() is not null or auth_role() is not null then raise exception 'Detached profile authorized: %',kind; end if;
  reset role;
  execute format('update %I set auth_user_id=$1 where id=$2',rel) using gen_random_uuid(),app;
  set local role authenticated;
  if auth_org() is not null or auth_role() is not null then raise exception 'Relinked profile authorized: %',kind; end if;
  reset role;
  execute format('update %I set auth_user_id=$1 where id=$2',rel) using uid,app;
  update auth.users set banned_until=now()+interval '1 day' where id=uid;
  set local role authenticated;
  if auth_org() is not null or auth_role() is not null then raise exception 'Banned Auth identity authorized'; end if;
  reset role;
  update auth.users set banned_until=null,deleted_at=now() where id=uid;
  set local role authenticated;
  if auth_org() is not null or auth_role() is not null then raise exception 'Deleted Auth identity authorized'; end if;
  reset role;
  update auth.users set deleted_at=null,raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}','"employee"') where id=uid;
  set local role authenticated;
  if auth_org() is not null or auth_role() is not null then raise exception 'Claim-first role change retained old database access'; end if;
  reset role;
  update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}',to_jsonb(role_name)) where id=uid;

 end loop;
 update auth.users set raw_app_meta_data=jsonb_build_object('organization_id',org,'app_user_id',app,'user_type','admin','role','owner') where id=uid;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'app_metadata',jsonb_build_object('organization_id',org,'app_user_id',app,'user_type','admin','role','owner'))::text,true);
 set local role authenticated;
 if auth_org() is distinct from org or auth_role() is distinct from 'owner' then raise exception 'Deletion test owner is not authorized'; end if;
 reset role;
 set local role service_role;
 perform start_organization_deletion(org,app,'admin',uid,'Profile authority',repeat('e',64));
 reset role;
 set local role authenticated;
 if auth_org() is not null or auth_role() is not null then raise exception 'Deletion freeze lost'; end if;
 reset role;
end $$;
rollback;
