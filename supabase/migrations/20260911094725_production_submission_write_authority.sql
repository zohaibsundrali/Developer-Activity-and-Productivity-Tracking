begin;
-- Submission and review APIs now commit through service-only transactions.
-- Historical org-wide permissive policies must not allow callers to replace
-- proof, forge attribution, delete pending work, or bypass those transactions.
-- Keep SELECT policies and referential-integrity cascades unchanged.
alter table public.task_submissions enable row level security;
drop policy if exists submission_workflow_insert on public.task_submissions;
create policy submission_workflow_insert on public.task_submissions as restrictive
  for insert to authenticated with check(false);
drop policy if exists submission_workflow_update on public.task_submissions;
create policy submission_workflow_update on public.task_submissions as restrictive
  for update to authenticated using(false) with check(false);
drop policy if exists submission_workflow_delete on public.task_submissions;
create policy submission_workflow_delete on public.task_submissions as restrictive
  for delete to authenticated using(false);
commit;
