import { describe, expect, it } from 'vitest';
import { canRemoveTaskReviewer } from '@/utils/taskReviewerRemoval';
import { resolvePermission } from '@/utils/permissionEngine';
const task = { id: 'task', organization_id: 'org' };
const watcher = { task_id: 'task', organization_id: 'org', user_id: 'person', user_type: 'developer', role: 'reviewer' };
const context = { organizationId: 'org', userId: 'actor', userType: 'developer' };
const check = (role = 'employee', overrides = {}, extra = {}) => canRemoveTaskReviewer({ task, watcher, context,
  allowed: key => resolvePermission({ role, overrides }, key), ...extra });
describe('reviewer removal capability', () => {
  it('allows typed self-removal after review permission was revoked', () => {
    expect(check('employee', { 'task.review': false, 'task.manage': false }, { context: { ...context, userId: 'person' } })).toBe(true);
  });
  it('does not confuse colliding profile identifiers with self', () => {
    expect(check('employee', {}, { context: { ...context, userId: 'person', userType: 'admin' } })).toBe(false);
  });
  it.each(['task.manage', 'task.review'])('allows individually granted %s', key => {
    expect(check('employee', { [key]: true })).toBe(true);
  });
  it('honors both individual denials for a manager', () => {
    expect(check('manager', { 'task.manage': false, 'task.review': false })).toBe(false);
  });
  it('refuses mismatched parent and organization even with owner permissions', () => {
    expect(check('owner', {}, { watcher: { ...watcher, task_id: 'other' } })).toBe(false);
    expect(check('owner', {}, { watcher: { ...watcher, organization_id: 'other' } })).toBe(false);
    expect(check('owner', {}, { task: { ...task, organization_id: 'other' } })).toBe(false);
  });
  it('does not apply reviewer removal controls to normal watchers or clients', () => {
    expect(check('owner', {}, { watcher: { ...watcher, role: 'watcher' } })).toBe(false);
    expect(check('owner', {}, { context: { ...context, userType: 'client' } })).toBe(false);
  });
});
