begin;
create or replace function public.auth_project_mutation(p_key text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.auth_org() is not null and not public.auth_is_client()
   and auth.jwt()->'app_metadata'->>'user_type' in ('admin','developer')
   and p_key in ('project.create','project.delete','project.hub')
   and coalesce(public.auth_override(p_key),case when p_key='project.delete' then public.auth_role() in ('owner','admin')
     else public.auth_role() in ('owner','admin','manager','team_lead') end,false);
$$;
revoke all on function public.auth_project_mutation(text) from public;
grant execute on function public.auth_project_mutation(text) to authenticated;
alter table public.projects enable row level security;
drop policy if exists project_mutation_insert on public.projects;
create policy project_mutation_insert on public.projects as restrictive for insert to authenticated
with check(organization_id=public.auth_org() and public.auth_project_mutation('project.create'));
drop policy if exists project_mutation_update on public.projects;
create policy project_mutation_update on public.projects as restrictive for update to authenticated
using(organization_id=public.auth_org() and public.auth_project_mutation('project.hub'))
with check(organization_id=public.auth_org() and public.auth_project_mutation('project.hub'));
drop policy if exists project_mutation_delete on public.projects;
create policy project_mutation_delete on public.projects as restrictive for delete to authenticated
using(organization_id=public.auth_org() and public.auth_project_mutation('project.delete'));

create or replace function public.guard_project_workflow_fields() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare field text; row_new jsonb:=to_jsonb(new); row_old jsonb; begin
 if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
 if tg_op='UPDATE' then
   row_old:=to_jsonb(old);
   foreach field in array array['status','progress','total_tasks_count','completed_tasks_count','total_productivity_score','id','organization_id','assigned_developer_id','assigned_developer_name','assigned_developer_email',
    'assigned_to','assigned_to_email','manager_id','created_by','added_by','added_by_admin','task_plan_submitted',
    'task_plan_status','task_plan_submitted_at','task_plan_reviewed_at','task_plan_reviewed_by','task_plan_rejection_reason',
    'completed_at','completed_by','client_signed_off_at','client_rating','client_feedback','closed_at','closed_by','closure_note'] loop
     if row_new->field is distinct from row_old->field then
       raise exception 'Project field requires the server workflow: %',field using errcode='42501'; end if;
   end loop;
 else
   if coalesce(row_new->>'status','pending') not in ('pending','active','on_hold') then
     raise exception 'New projects cannot start completed or closed' using errcode='42501'; end if;
   foreach field in array array['progress','total_tasks_count','completed_tasks_count','total_productivity_score'] loop
     if coalesce((row_new->>field)::numeric,0)<>0 then
       raise exception 'New project cannot carry delivery totals: %',field using errcode='42501'; end if;
   end loop;
   if coalesce((row_new->>'task_plan_submitted')::boolean,false)
     or coalesce(row_new->>'task_plan_status','draft') not in ('draft','') then
     raise exception 'New projects require an unsubmitted draft plan' using errcode='42501'; end if;
   foreach field in array array['task_plan_submitted_at','task_plan_reviewed_at','task_plan_reviewed_by','task_plan_rejection_reason',
     'completed_at','completed_by','client_signed_off_at','client_rating','client_feedback','closed_at','closed_by','closure_note'] loop
     if row_new->field is not null and row_new->field<>'null'::jsonb then
       raise exception 'New project cannot carry workflow history: %',field using errcode='42501'; end if;
   end loop;
   if new.assigned_developer_id is not null and not exists(select 1 from public.memberships where organization_id=new.organization_id
      and user_id=new.assigned_developer_id and user_type='developer' and status='active' and role<>'client') then
     raise exception 'Project assignee must be active staff in this organization' using errcode='42501'; end if;
   if nullif(row_new->>'assigned_to','') is not null and row_new->>'assigned_to' is distinct from row_new->>'assigned_developer_id' then
     raise exception 'Project assignment identities must agree' using errcode='42501'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_project_workflow_fields() from public;
drop trigger if exists project_workflow_fields on public.projects;
create trigger project_workflow_fields before insert or update on public.projects for each row execute function public.guard_project_workflow_fields();
commit;
