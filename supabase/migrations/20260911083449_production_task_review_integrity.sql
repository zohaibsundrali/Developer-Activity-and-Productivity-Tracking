begin;
-- Approval/rejection and scoring go through the server review/submission APIs.
create or replace function public.guard_task_review_integrity()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public as $$
declare field text; after_row jsonb := to_jsonb(new); before_row jsonb;
begin
  if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
  if tg_op='INSERT' then
    if new.status in ('completed','rejected') then
      raise exception 'Task verdicts require the review workflow' using errcode='42501';
    end if;
  else
    before_row := to_jsonb(old);
    if new.status is distinct from old.status and
      (new.status in ('completed','rejected') or old.status='completed') then
      raise exception 'Task verdicts require the review workflow' using errcode='42501';
    end if;
  end if;
  foreach field in array array['reviewed_by','reviewed_at','admin_comments',
    'rejection_reason','is_on_time','productivity_points','actual_completion_date','submitted_at'] loop
    if tg_op='INSERT' then
      if after_row->field is not null and after_row->field <> 'null'::jsonb
        and not (field='productivity_points' and after_row->field='0'::jsonb) then
        raise exception 'Task review field requires the review workflow: %',field using errcode='42501';
      end if;
    elsif after_row->field is distinct from before_row->field then
      raise exception 'Task review field requires the review workflow: %',field using errcode='42501';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists task_review_integrity on public.developer_tasks;
create trigger task_review_integrity before insert or update on public.developer_tasks
for each row execute function public.guard_task_review_integrity();
commit;
