\ir typed_project_manager_roster.sql
create function auth.uid() returns uuid language sql stable as $$select public.auth_app_user_id();$$;
-- Replace only the old fixture's no-op quota lock with the production lock shape.
create or replace function app_private.lock_quota(p_org uuid) returns void language plpgsql as $$begin perform pg_advisory_xact_lock(hashtextextended(p_org::text,0)); end$$;
\ir ../../supabase/migrations/20260914083031_production_project_github_link.sql
create function github_test_claims(kind text default 'admin', person uuid default '74000000-0000-0000-0000-000000000011') returns text language sql as $$select jsonb_build_object('org','74000000-0000-0000-0000-000000000001','user',person,'type',kind,'app_metadata',jsonb_build_object('user_type',kind))::text;$$;
select set_config('request.jwt.claims',github_test_claims(),false);
set role authenticated;
do $$declare value jsonb; p uuid:='74000000-0000-0000-0000-000000000104';begin
 value:=save_project_github(p,0,123,'octocat','Hello-World');
 if value->>'version'<>'1' then raise exception 'Link version invalid'; end if;
 value:=save_project_github(p,0,123,'octocat','Hello-World');
 if value->>'version'<>'1' then raise exception 'Link replay created another version'; end if;
 if project_github_context(p)->'link'->>'repository_id'<>'123' then raise exception 'Link not readable'; end if;
 begin perform save_project_github(p,0,456,'octocat','Other'); raise exception 'Stale update accepted'; exception when serialization_failure then null; end;
 begin update project_github_links set repository='Forged'; raise exception 'Direct mutation accepted'; exception when insufficient_privilege then null; end;
 perform save_project_github(p,1,null,null,null);
 if project_github_context(p)->'link'->>'repository_id' is not null then raise exception 'Disconnect failed'; end if;
 begin perform save_project_github(p,0,456,'octocat','Other'); raise exception 'Stale relink accepted'; exception when serialization_failure then null; end;
 perform save_project_github(p,2,456,'octocat','Other');
 begin perform save_project_github(p,3,456,'evil/host','Other'); raise exception 'Invalid owner accepted'; exception when invalid_parameter_value then null; end;
 begin perform save_project_github('74000000-0000-0000-0000-000000999999',0,123,'octocat','Other'); raise exception 'Foreign project accepted'; exception when insufficient_privilege or no_data_found then null; end;
end$$;
reset role;
begin;
insert into user_permissions(user_id,user_type,permission_key,allowed,membership_id) select user_id,user_type,'project.manage_members',false,id from memberships where user_id='74000000-0000-0000-0000-000000000011' and user_type='admin';
set local role authenticated;
do $$begin
 if (project_github_context('74000000-0000-0000-0000-000000000104')->>'can_manage')::boolean then raise exception 'Explicit denied management exposed'; end if;
 begin perform save_project_github('74000000-0000-0000-0000-000000000104',3,789,'octocat','Denied'); raise exception 'Denied management bypassed'; exception when insufficient_privilege then null; end;
end$$;
reset role;
rollback;
-- A suspended typed membership cannot use either read or write helpers.
begin;
update memberships set status='suspended' where user_id='74000000-0000-0000-0000-000000000011' and user_type='admin';
set local role authenticated;
do $$begin
 if exists(select 1 from project_github_links) then raise exception 'Suspended reader saw links'; end if;
 begin perform project_github_context('74000000-0000-0000-0000-000000000104'); raise exception 'Suspended context allowed'; exception when insufficient_privilege then null; end;
end$$;
reset role;
rollback;
select 'project GitHub link SQL contracts passed' as result;
