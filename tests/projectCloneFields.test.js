import { expect, it } from 'vitest';
import { projectCloneFields } from '../src/utils/projectCloneFields';
it('clones configuration without carrying another project approval or closure', () => {
 const source = { id: 'old', name: 'Old', organization_id: 'org', assigned_developer_id: 'dev', description: 'Scope',
  task_plan_status: 'approved', task_plan_reviewed_by: 'reviewer', task_plan_submitted: true,
  completed_at: 'yesterday', completed_by: 'manager', client_signed_off_at: 'yesterday', client_rating: 5,
  client_feedback: 'Accepted', closed_at: 'today', closed_by: 'owner', closure_note: 'Final',
  total_tasks_count: 10, progress: 100, created_by: 'creator' };
 expect(projectCloneFields(source)).toEqual({ organization_id: 'org', assigned_developer_id: 'dev', description: 'Scope', created_by: 'creator' });
 expect(source.task_plan_status).toBe('approved');
});
