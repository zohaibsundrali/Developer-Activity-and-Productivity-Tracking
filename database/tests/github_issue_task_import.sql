\ir project_github_link.sql
\ir ../../supabase/migrations/20260914182129_production_github_issue_task_import.sql
create function github_import_issue(n bigint default 1) returns jsonb language sql as $$select jsonb_build_object('repository_id',456,'id',9000+n,'number',n,'title','Imported issue','body','Original description','state','closed','updated_at','2026-09-14T09:00:00Z','url','https://github.com/octocat/Other/issues/'||n);$$;
create function github_import_test(n bigint default 1,v integer default 3) returns jsonb language sql security invoker as $$select import_github_issue_task('74000000-0000-0000-0000-000000000104',v,github_import_issue(n),'2026-09-15','2026-09-17');$$;
select set_config('request.jwt.claims',github_test_claims(),false);
set role authenticated;
do $$declare first jsonb;retry jsonb;task uuid;begin
 if not (project_github_context('74000000-0000-0000-0000-000000000104')->>'can_import')::boolean then raise exception 'Import access missing';end if;
 first:=github_import_test();task:=(first->'task'->>'id')::uuid;
 if first->>'unchanged'<>'false' or first->'task'->>'status'<>'pending' then raise exception 'Initial import receipt invalid';end if;
 if not exists(select 1 from developer_tasks where id=task and developer_id is null and not client_visible and priority='medium' and task_type='feature') then raise exception 'Import inferred assignment or visibility';end if;
 update developer_tasks set task_title='Local edit',task_description='Local description',status='in_progress' where id=task;
 retry:=github_import_test();if retry->>'unchanged'<>'true' or retry->'task'->>'id'<>task::text or retry->'task'->>'title'<>'Local edit' or retry->'task'->>'status'<>'in_progress' then raise exception 'Retry overwrote local task';end if;
 if (select count(*) from github_issue_task_imports)<>1 then raise exception 'Duplicate mapping';end if;
 begin perform github_import_test(2,2);raise exception 'Stale link accepted';exception when serialization_failure then null;end;
 begin update github_issue_task_imports set issue_number=999;raise exception 'Direct source rewrite accepted';exception when insufficient_privilege then null;end;
 -- A reservation alone cannot commit without its corresponding task.
 begin
 perform app_private.reserve_github_issue_task('74000000-0000-0000-0000-000000000104',3,github_import_issue(10),'2026-09-15','2026-09-17');
 set constraints all immediate;
 raise exception 'Orphan reservation accepted';
 exception when foreign_key_violation then null;end;
 set constraints all deferred;
 delete from developer_tasks where id=task;
 retry:=github_import_test();if retry->'import'->>'task_id' is not null or retry->'task'<>'null'::jsonb or retry->>'unchanged'<>'true' then raise exception 'Deleted task resurrected';end if;
end$$;
reset role;
-- Real task insertion guard failure must roll back the reserved identity.
select set_config('test.clone_quota_failure','yes',false);
set role authenticated;
do $$begin
 begin perform github_import_test(2);raise exception 'Task quota failure bypassed';exception when others then if sqlerrm not like '%PLAN_LIMIT_REACHED%' then raise;end if;end;
 if exists(select 1 from github_issue_task_imports where issue_number=2) then raise exception 'Failed task insert retained import';end if;
end$$;
reset role;
select set_config('test.clone_quota_failure','no',false);
-- Explicit task management denial applies even to project owners.
begin;
insert into user_permissions(user_id,user_type,permission_key,allowed,membership_id) select user_id,user_type,'task.manage',false,id from memberships where user_id='74000000-0000-0000-0000-000000000011' and user_type='admin';
set local role authenticated;
do $$begin
 if (project_github_context('74000000-0000-0000-0000-000000000104')->>'can_import')::boolean then raise exception 'Denied import control exposed';end if;
 begin perform github_import_test(3);raise exception 'Task deny bypassed';exception when insufficient_privilege then null;end;
end$$;
reset role;
rollback;
-- Task INSERT RLS still applies independently of the import permission.
begin;
create policy import_test_task_deny on developer_tasks as restrictive for insert to authenticated with check(false);
set local role authenticated;
do $$begin
 begin perform github_import_test(4);raise exception 'Invoker task RLS bypassed';exception when insufficient_privilege then null;end;
 if exists(select 1 from github_issue_task_imports where issue_number=4) then raise exception 'RLS failure left import behind';end if;
end$$;
reset role;
rollback;
begin;
create or replace function app_private.org_unlocked(uuid) returns boolean language sql stable as $$select false$$;
set local role authenticated;
do $$begin
 begin perform github_import_test(20);raise exception 'Billing bypassed';exception when others then if sqlerrm not like 'BILLING_LOCKED%' then raise;end if;end;
end$$;
reset role;
rollback;
begin;
insert into user_permissions(user_id,user_type,permission_key,allowed,membership_id) select m.user_id,m.user_type,k,false,m.id from memberships m cross join unnest(array['task.view_all','task.review']) k where m.user_id='74000000-0000-0000-0000-000000000011' and m.user_type='admin';
set local role authenticated;
do $$begin
 if (project_github_context('74000000-0000-0000-0000-000000000104')->>'can_import')::boolean then raise exception 'Missing task read permitted import';end if;
 if exists(select 1 from github_issue_task_imports) then raise exception 'Source metadata escaped task read denial';end if;
end$$;
reset role;
rollback;
set role authenticated;
do $$begin
 begin perform import_github_issue_task('74000000-0000-0000-0000-000000999999',3,github_import_issue(21),'2026-09-15','2026-09-17');raise exception 'Foreign project import accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 'GitHub issue task import contracts passed' as result;
