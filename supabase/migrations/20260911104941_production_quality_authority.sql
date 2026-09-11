begin;
-- All QA mutations use verified service APIs. Prevent direct row writes from
-- bypassing atomic run scope, defect linking, actor attribution and billing.
-- Retain existing read permissions, but require them even when a historical
-- permissive FOR ALL management policy would otherwise also grant SELECT.
create or replace function public.auth_quality_read() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.auth_org() is not null and not public.auth_is_client()
  and auth.jwt()->'app_metadata'->>'user_type' in ('admin','developer')
  and coalesce(public.auth_override('test_case.view'),public.auth_role() in
    ('owner','admin','manager','team_lead','qa','developer','designer','devops','employee'),false);
$$;
revoke all on function public.auth_quality_read() from public;
grant execute on function public.auth_quality_read() to authenticated;
do $$ declare tbl text; begin
 foreach tbl in array array['test_cases','test_runs','test_executions'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('drop policy if exists quality_read_authority on public.%I',tbl);
  execute format('create policy quality_read_authority on public.%I as restrictive for select to authenticated using
   (organization_id=public.auth_org() and public.auth_quality_read())',tbl);
  execute format('drop policy if exists quality_workflow_insert on public.%I',tbl);
  execute format('create policy quality_workflow_insert on public.%I as restrictive for insert to authenticated with check(false)',tbl);
  execute format('drop policy if exists quality_workflow_update on public.%I',tbl);
  execute format('create policy quality_workflow_update on public.%I as restrictive for update to authenticated using(false) with check(false)',tbl);
  execute format('drop policy if exists quality_workflow_delete on public.%I',tbl);
  execute format('create policy quality_workflow_delete on public.%I as restrictive for delete to authenticated using(false)',tbl);
 end loop;
end $$;
commit;
