alter table projects add column assigned_developer_id uuid, add column task_plan_status text,
  add column task_plan_submitted boolean, add column task_plan_submitted_at timestamptz,
  add column task_plan_reviewed_at timestamptz, add column task_plan_reviewed_by uuid,
  add column task_plan_rejection_reason text;
alter table developer_tasks add column project_id uuid references projects on delete cascade,
  add column developer_id uuid, add column task_title text, add column task_description text,
  add column task_order int, add column start_date date, add column end_date date,
  add column created_at timestamptz, add column updated_at timestamptz;
create table task_submissions(id uuid primary key default gen_random_uuid(),task_id uuid references developer_tasks on delete cascade);

create table task_comments_fixture(id uuid primary key default gen_random_uuid(),task_id uuid references developer_tasks on delete cascade,body text);
