import { describe, it, expect } from 'vitest';
import { taskAssignee, isTaskAssignee, taskAssignmentPatch, taskAssignmentKey } from '@/utils/taskAssignment';
import { taskUiPermissions } from '@/utils/taskUiPermissions';

describe('typed task assignment', () => {
  it('retains legacy developer assignments and atomically changes profile type', () => {
    expect(taskAssignmentPatch('dev')).toEqual({ developer_id: 'dev', assignee_admin_id: null });
    expect(taskAssignmentPatch({ userId: 'owner', userType: 'admin' })).toEqual({ developer_id: null, assignee_admin_id: 'owner' });
    expect(taskAssignmentPatch(null)).toEqual({ developer_id: null, assignee_admin_id: null });
    expect(taskAssignmentKey({ assignee_admin_id: 'owner' })).toBe('admin:owner');
    expect(() => taskAssignmentPatch({ userType: 'client', userId: 'client' })).toThrow();
  });
  it('fails closed for ambiguous assignments and cross-profile UUID collisions', () => {
    expect(taskAssignee({ developer_id: 'same', assignee_admin_id: 'same' })).toBeNull();
    expect(isTaskAssignee({ developer_id: 'same' }, { userType: 'admin', userId: 'same' })).toBe(false);
    expect(isTaskAssignee({ assignee_admin_id: 'same' }, { userType: 'developer', userId: 'same' })).toBe(false);
    expect(isTaskAssignee({ assignee_admin_id: 'profile' }, { userType: 'admin', appUserId: 'profile', userId: 'auth-id' })).toBe(true);
    expect(isTaskAssignee({ assignee_admin_id: 'profile' }, { userType: 'admin', appUserId: null, userId: 'profile' })).toBe(false);
  });
  it('separates personal update permission from management and organization access', () => {
    const task = { organization_id: 'org', assignee_admin_id: 'owner' };
    const context = { organizationId: 'org', userType: 'admin', userId: 'owner' };
    const allowed = key => key === 'task.update_own';
    expect(taskUiPermissions({ task, context, allowed }).move).toBe(true);
    expect(taskUiPermissions({ task, context, allowed }).manage).toBe(false);
    expect(taskUiPermissions({ task: { ...task, assignee_admin_id: 'other' }, context, allowed }).move).toBe(false);
    expect(taskUiPermissions({ task: { ...task, organization_id: 'other' }, context, allowed }).move).toBe(false);
  });
});
