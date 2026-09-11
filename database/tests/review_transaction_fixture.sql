alter table projects add column created_by uuid, add column added_by uuid, add column total_tasks_count int,
  add column completed_tasks_count int, add column total_productivity_score numeric, add column progress numeric,
  add column updated_at timestamptz;
alter table task_submissions add column organization_id uuid, add column developer_id uuid,
  add column review_status text default 'pending',add column is_reviewed boolean default false,
  add column reviewed_by uuid,add column reviewed_at timestamptz,add column review_comments text,
  add column submitted_at timestamptz,add column file_url text;
create table admin_reviews(id uuid primary key default gen_random_uuid(),organization_id uuid references organizations on delete cascade,
  admin_id uuid,admin_email text,admin_name text,task_id uuid,submission_id uuid,project_id uuid,developer_id uuid,
  review_action text,review_comments text,rejection_reason text,task_title text,submission_file_url text,
  deadline date,submission_date timestamptz,reviewed_at timestamptz);
create table activity_logs(id uuid primary key default gen_random_uuid(),organization_id uuid references organizations on delete cascade,
  developer_id uuid,project_id uuid,task_id uuid,action_type text,action_description text,old_value text,new_value text);
create table productivity_metrics(organization_id uuid references organizations on delete cascade,developer_id uuid,project_id uuid,
  total_tasks int,completed_on_time int,completed_late int,pending_tasks int,rejected_tasks int,
  productivity_percentage numeric,productivity_points int,updated_at timestamptz,unique(developer_id,project_id));
create table notifications(id uuid primary key default gen_random_uuid(),organization_id uuid references organizations on delete cascade,
  developer_id uuid,admin_id text,type text,title text,message text,project_id uuid,task_id uuid,submission_id uuid,read boolean);
create function reject_review_notification() returns trigger language plpgsql as $$ begin
  if current_setting('test.fail_notification',true)='yes' then raise exception 'INJECTED_FAILURE'; end if;
  return new;
end $$;
create trigger fixture_notification_failure before insert on notifications for each row execute function reject_review_notification();
