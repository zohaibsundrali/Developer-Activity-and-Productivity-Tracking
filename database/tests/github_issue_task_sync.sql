\ir github_issue_task_import.sql
\ir ../../supabase/migrations/20260914185642_production_github_issue_task_sync.sql
create function public.github_sync_test(p_id uuid,p_expected text,p_source jsonb,p_title text default 'auto',p_description text default 'auto') returns jsonb language plpgsql security invoker as $$
declare result jsonb;begin
 result:=sync_github_issue_task('74000000-0000-0000-0000-000000000104',p_id,(select id from github_issue_task_imports where issue_number=50),3,p_expected,p_source,p_title,p_description);
 -- Each production request commits separately. Flush each test's deferred audit
 -- assertion before exercising another edit in the fixture's DO transaction.
 set constraints all immediate;set constraints all deferred;return result;
end$$;
select set_config('request.jwt.claims',github_test_claims(),false);
set role authenticated;
select github_import_test(50);
do $$declare context jsonb;result jsonb;source jsonb;fp text;task uuid;begin
 context:=github_issue_sync_context('74000000-0000-0000-0000-000000000104',50);fp:=context->>'fingerprint';task:=(context->'snapshot'->'task'->>'id')::uuid;
 source:=jsonb_set(github_import_issue(50),'{title}','"Remote v2"');
 result:=github_sync_test('d1000000-0000-0000-0000-000000000001',fp,source);
 if result->'event'->'applied'->>'title'<>'Remote v2' or result->>'unchanged'<>'false' then raise exception 'Remote update not applied';end if;
 update developer_tasks set status='in_progress',task_title='Local edit' where id=task;
 result:=github_sync_test('d1000000-0000-0000-0000-000000000001',fp,source);
 if result->>'unchanged'<>'true' or not exists(select 1 from developer_tasks where id=task and task_title='Local edit') then raise exception 'Retry overwrote newer local edits';end if;
 context:=github_issue_sync_context('74000000-0000-0000-0000-000000000104',50);source:=jsonb_set(source,'{title}','"Remote v3"');
 begin perform github_sync_test('d1000000-0000-0000-0000-000000000002',context->>'fingerprint',source);raise exception 'Conflicting auto sync accepted';exception when serialization_failure then null;end;
 perform github_sync_test('d1000000-0000-0000-0000-000000000002',context->>'fingerprint',source,'local','auto');
 context:=github_issue_sync_context('74000000-0000-0000-0000-000000000104',50);
 if context->'snapshot'->'baseline'->>'title'<>'Remote v3' or context->'snapshot'->'task'->>'title'<>'Local edit' then raise exception 'Keep-local baseline incorrect';end if;
 perform github_sync_test('d1000000-0000-0000-0000-000000000003',context->>'fingerprint',source);
 context:=github_issue_sync_context('74000000-0000-0000-0000-000000000104',50);
 perform github_sync_test('d1000000-0000-0000-0000-000000000004',context->>'fingerprint',jsonb_set(source,'{title}','"Remote v4"'),'github','auto');
 if not exists(select 1 from developer_tasks where id=task and task_title='Remote v4' and status='in_progress' and developer_id is null and start_date='2026-09-15' and end_date='2026-09-17' and not client_visible) then raise exception 'Sync altered workflow fields';end if;
 if (select count(*) from github_issue_task_syncs)<>4 then raise exception 'Replay or conflict left extra audit';end if;
 begin update github_issue_task_syncs set title_choice='github';raise exception 'Audit rewrite accepted';exception when insufficient_privilege then null;end;
 begin perform github_sync_test('d1000000-0000-0000-0000-000000000009',fp,source);raise exception 'Stale local preview accepted';exception when serialization_failure then null;end;
end$$;
reset role;
begin;
create policy sync_test_update_deny on developer_tasks as restrictive for update to authenticated using(false) with check(false);
set local role authenticated;
do $$declare context jsonb;begin
 context:=github_issue_sync_context('74000000-0000-0000-0000-000000000104',50);
 begin perform github_sync_test('d1000000-0000-0000-0000-000000000010',context->>'fingerprint',github_import_issue(50),'github','github');raise exception 'Task UPDATE RLS bypassed';exception when insufficient_privilege or no_data_found then null;end;
 if exists(select 1 from github_issue_task_syncs where id='d1000000-0000-0000-0000-000000000010') then raise exception 'Failed update left audit';end if;
end$$;
reset role;
rollback;
set role authenticated;
do $$declare context jsonb;begin
 context:=github_issue_sync_context('74000000-0000-0000-0000-000000000104',50);
 begin
 insert into github_issue_task_syncs(id,import_id,link_version,expected,source,title_choice,description_choice)
 values('d1000000-0000-0000-0000-000000000011',(context->'snapshot'->>'import_id')::uuid,3,context->>'fingerprint',github_import_issue(50),'github','github');
 set constraints all immediate;raise exception 'Audit without task update accepted';
 exception when check_violation then null;end;
 set constraints all deferred;
 if exists(select 1 from github_issue_task_syncs where id='d1000000-0000-0000-0000-000000000011') then raise exception 'Unapplied audit retained';end if;
end$$;
reset role;
select 'GitHub task sync contracts passed' as result;
