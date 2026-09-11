-- Run after the isolated typed_notification fixture and migration.
alter table notifications add column message text,add column type text,add column created_at timestamptz default now(),
 add column task_id uuid,add column project_id uuid,add column submission_id uuid,add column entity_type text,
 add column entity_id uuid,add column actor_id uuid,add column metadata jsonb default '{}',add column dismissed_at timestamptz;
update notifications set read=true,read_at='2026-01-01T01:00:00Z' where title='multi';
update notifications set dismissed_at='2026-01-02T01:00:00Z' where title='manager email';
