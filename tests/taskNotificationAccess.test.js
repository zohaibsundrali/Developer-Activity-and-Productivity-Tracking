import { describe, expect, it } from 'vitest';
import { canReceiveTaskNotification as can } from '@/utils/taskNotificationAccess';
const task = { organization_id: 'org', developer_id: 'assignee' };
const subject = (role, extra = {}) => ({ orgId: 'org', appUserId: 'other', userType: 'developer', role, overrides: {}, ...extra });
describe('task notification access', () => {
  it.each(['owner', 'admin', 'manager', 'team_lead', 'qa'])('%s can receive work they may read or review', role => {
    expect(can(subject(role), task)).toBe(true);
  });
  it.each(['developer', 'designer', 'devops', 'employee', 'hr', 'finance'])('%s cannot receive an unrelated task', role => {
    expect(can(subject(role), task)).toBe(false);
    expect(can(subject(role, { appUserId: 'assignee' }), task)).toBe(true);
  });
  it('rejects clients even with a forged owner role', () => {
    expect(can(subject('owner', { userType: 'client' }), task)).toBe(false);
  });
  it('does not confuse an admin profile UUID with an assigned developer UUID', () => {
    expect(can(subject('hr', { userType: 'admin', appUserId: 'assignee' }), task)).toBe(false);
  });
  it('honors explicit reader/reviewer denials and grants', () => {
    expect(can(subject('owner', { overrides: { 'task.view_all': false, 'task.review': false } }), task)).toBe(false);
    expect(can(subject('developer', { overrides: { 'task.view_all': true } }), task)).toBe(true);
    expect(can(subject('developer', { appUserId: 'assignee', overrides: { 'task.view_own': false } }), task)).toBe(false);
  });
  it('fails closed on unknown permissions or tenant mismatch', () => {
    expect(can(subject('owner', { overridesUnavailable: true }), task)).toBe(false);
    expect(can(subject('owner', { orgId: 'elsewhere' }), task)).toBe(false);
    expect(can(null, task)).toBe(false);
  });
});
