begin;
create function public.auth_productivity_permission(p_key text) returns boolean
language sql stable security invoker set search_path=pg_catalog,public as $$
 select p_key in ('report.view','productivity.view_own','productivity.recalculate') and auth.uid() is not null and public.auth_org() is not null and auth.jwt()->'app_metadata'->>'user_type' in ('admin','developer')
 and coalesce(public.auth_override(p_key),case when p_key='productivity.recalculate' then public.auth_role() in ('owner','admin')
 when p_key='report.view' then public.auth_role() in ('owner','admin','manager','team_lead')
 when p_key='productivity.view_own' then public.auth_role() in ('owner','admin','manager','team_lead','hr','qa','developer','designer','devops','employee','finance') else false end,false);
$$;
revoke all on function public.auth_productivity_permission(text) from public,anon;
grant execute on function public.auth_productivity_permission(text) to authenticated;
alter table public.productivity_metrics enable row level security;
-- Cached scores are derived data. A browser cannot set or delete them directly.
revoke insert,update,delete on public.productivity_metrics from authenticated,anon;
create policy productivity_metric_insert_guard on public.productivity_metrics as restrictive for insert to authenticated with check(false);
create policy productivity_metric_update_guard on public.productivity_metrics as restrictive for update to authenticated using(false) with check(false);
create policy productivity_metric_delete_guard on public.productivity_metrics as restrictive for delete to authenticated using(false);
create policy productivity_metric_read_guard on public.productivity_metrics as restrictive for select to authenticated using(
 organization_id=(select public.auth_org()) and
 (((select public.auth_productivity_permission('report.view')) and (select public.auth_plan_feature('reports')))
 or (developer_id=(select public.auth_app_user_id()) and (select auth.jwt()->'app_metadata'->>'user_type')='developer' and (select public.auth_productivity_permission('productivity.view_own')))));

-- Trusted review/recalculation writers share this derivation. No user-supplied
-- score, mutable source label, or session flag is treated as authority.
create function public.guard_canonical_productivity_metric() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare totals record;
begin
 if tg_op='UPDATE' and (new.organization_id,new.developer_id,new.project_id) is distinct from (old.organization_id,old.developer_id,old.project_id) then raise exception 'PRODUCTIVITY_IDENTITY_IMMUTABLE' using errcode='42501';end if;
 if new.organization_id is null then raise exception 'PRODUCTIVITY_TARGET_INVALID' using errcode='23514';end if;
 perform app_private.lock_quota(new.organization_id);
 if new.developer_id is null or new.project_id is null
 or not exists(select 1 from public.developers d where d.id=new.developer_id and d.organization_id=new.organization_id)
 or not exists(select 1 from public.projects p where p.id=new.project_id and p.organization_id=new.organization_id) then raise exception 'PRODUCTIVITY_TARGET_INVALID' using errcode='23514';end if;
 if not coalesce(app_private.org_unlocked(new.organization_id),false) then raise exception 'BILLING_LOCKED: subscription requires attention' using errcode='P0001';end if;
 select count(*) total,count(*) filter(where state='completed' and is_on_time=true) timely,count(*) filter(where state='completed' and is_on_time=false) late,
 count(*) filter(where state in ('pending','in_progress','awaiting_approval')) pending,count(*) filter(where state='rejected') rejected into totals
 from (select t.is_on_time,case when t.status in ('completed','done','approved') then 'completed' when t.status in ('awaiting_approval','reviewed','in_review') then 'awaiting_approval'
 when t.status in ('in_progress','doing') then 'in_progress' when t.status='rejected' then 'rejected' else 'pending' end state
 from public.developer_tasks t where t.organization_id=new.organization_id and t.developer_id=new.developer_id and t.project_id=new.project_id) x;
 new.total_tasks:=totals.total;new.completed_on_time:=totals.timely;new.completed_late:=totals.late;new.pending_tasks:=totals.pending;new.rejected_tasks:=totals.rejected;
 new.productivity_points:=totals.timely-totals.late;
 new.productivity_percentage:=coalesce(round(greatest(0,least(100,(totals.timely-totals.late+totals.pending*0.5)*100/nullif(totals.total,0))),2),0);
 -- PostgreSQL greatest/least ignore NULL; explicitly make an empty group zero.
 if totals.total=0 then new.productivity_percentage:=0;end if;
 new.updated_at:=statement_timestamp();return new;
end $$;
revoke all on function public.guard_canonical_productivity_metric() from public,anon,authenticated;
create trigger zzz_canonical_productivity_metric before insert or update on public.productivity_metrics for each row execute function public.guard_canonical_productivity_metric();

create function public.recalculate_productivity(p_developer uuid default null,p_project uuid default null,p_all boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org(); pair record; changed integer:=0;
begin
 if not coalesce(public.auth_productivity_permission('productivity.recalculate'),false) then raise exception 'PRODUCTIVITY_FORBIDDEN' using errcode='42501';end if;
 if p_all is null or (p_all and (p_developer is not null or p_project is not null)) or (not p_all and (p_developer is null or p_project is null)) then raise exception 'PRODUCTIVITY_INPUT_INVALID' using errcode='22023';end if;
 perform app_private.lock_quota(org);
 if public.auth_org() is distinct from org or not coalesce(public.auth_productivity_permission('productivity.recalculate'),false) then raise exception 'PRODUCTIVITY_FORBIDDEN' using errcode='42501';end if;
 if not coalesce(public.auth_plan_feature('reports'),false) then raise exception 'PRODUCTIVITY_PLAN_REQUIRED' using errcode='42501';end if;
 if not coalesce(app_private.org_unlocked(org),false) then raise exception 'BILLING_LOCKED: subscription requires attention' using errcode='P0001';end if;
 if not p_all and (not exists(select 1 from public.developers where id=p_developer and organization_id=org) or not exists(select 1 from public.projects where id=p_project and organization_id=org)) then raise exception 'PRODUCTIVITY_TARGET_NOT_FOUND' using errcode='P0002';end if;
 for pair in
 select p_developer developer_id,p_project project_id where not p_all
 union select t.developer_id,t.project_id from public.developer_tasks t where p_all and t.organization_id=org and t.developer_id is not null and t.project_id is not null
 union select m.developer_id,m.project_id from public.productivity_metrics m where p_all and m.organization_id=org
 order by developer_id,project_id
 loop
  -- The trigger derives every field after the shared organization lock, using
  -- complete task data. Refresh old groups even when all their tasks are gone.
  insert into public.productivity_metrics(organization_id,developer_id,project_id) values(org,pair.developer_id,pair.project_id)
  on conflict(developer_id,project_id) do update set updated_at=statement_timestamp();
  changed:=changed+1;
 end loop;
 return jsonb_build_object('orgId',org,'updatedCount',changed,'target',jsonb_build_object('developerId',p_developer,'projectId',p_project,'all',p_all));
end $$;
revoke all on function public.recalculate_productivity(uuid,uuid,boolean) from public,anon,service_role;
grant execute on function public.recalculate_productivity(uuid,uuid,boolean) to authenticated;
commit;
