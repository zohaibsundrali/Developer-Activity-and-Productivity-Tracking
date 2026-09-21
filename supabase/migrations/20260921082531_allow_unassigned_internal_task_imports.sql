begin;
-- Issue import deliberately creates an internal, pending, unassigned task.
-- Older installations still require developer_id, although the importer, UI,
-- relationship guards and RLS all support NULL until an explicit assignment.
-- Preserve every existing assignment, foreign key, policy and review guard.
alter table public.developer_tasks alter column developer_id drop not null;
notify pgrst, 'reload schema';
commit;
