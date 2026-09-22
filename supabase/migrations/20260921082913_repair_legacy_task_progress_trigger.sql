begin;
-- The old invoker trigger changed lifecycle status and protected rollup columns,
-- so authorized task writes failed the project workflow guard. Recompute only
-- numeric rollups, inside this non-callable trigger; never complete/close a project.
create or replace function public.update_project_progress() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare old_project uuid; old_org uuid; new_project uuid; new_org uuid;
 target record; total_count integer; completed_count integer;
begin
 if tg_op<>'INSERT' then old_project:=old.project_id;old_org:=old.organization_id;end if;
 if tg_op<>'DELETE' then new_project:=new.project_id;new_org:=new.organization_id;end if;
 for target in select distinct v.id,v.org from (values(old_project,old_org),(new_project,new_org)) v(id,org)
   where v.id is not null and v.org is not null order by v.id,v.org
 loop
  -- Serialize counts, including moves, without touching an unrelated tenant.
  perform 1 from public.projects where id=target.id and organization_id=target.org for update;
  if not found then continue;end if;
  select count(*)::integer,count(*) filter(where status='completed')::integer into total_count,completed_count
   from public.developer_tasks where project_id=target.id and organization_id=target.org;
  update public.projects set total_tasks_count=total_count,completed_tasks_count=completed_count,
   progress=case when total_count=0 then 0 else round(completed_count*100.0/total_count) end,
   updated_at=now() where id=target.id and organization_id=target.org;
 end loop;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function public.update_project_progress() from public,anon,authenticated;
drop trigger if exists trigger_update_project_progress on public.developer_tasks;
create trigger trigger_update_project_progress after insert or delete or update of status,project_id,organization_id
 on public.developer_tasks for each row execute function public.update_project_progress();
notify pgrst,'reload schema';
commit;
