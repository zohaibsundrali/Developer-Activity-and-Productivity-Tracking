import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadDashboardOwnProjects } from '../src/utils/dashboardOwnProjects';
import { canAccessAdminSection, staffNav } from '../src/components/shell/navConfig';
import { loadPermissionSet, clearPermissionSet } from '../src/utils/permissions';

function database({ memberships = [], projects = [], failTable } = {}) {
  const calls = [];
  return { calls, from(table) {
    const filters = [];
    const q = {
      select() { return q; }, order() { return q; },
      eq(key, value) { filters.push(row => row[key] === value); calls.push([table, key, value]); return q; },
      in(key, values) { filters.push(row => values.includes(row[key])); return q; },
      async range(start, end) {
        if (table === failTable) return { data: null, error: new Error('Unavailable') };
        return { data: (table === 'project_members' ? memberships : projects)
          .filter(row => filters.every(test => test(row))).slice(start, end + 1), error: null };
      },
    };
    return q;
  } };
}
const ctx = { organizationId: 'org', userId: 'person', userType: 'developer' };
const project = (id, extra = {}) => ({ id, organization_id: 'org', created_at: '2026-01-01', ...extra });
const member = (project_id, extra = {}) => ({ project_id, organization_id: 'org', user_id: 'person', user_type: 'developer', ...extra });

describe('Dashboard own projects', () => {
  it('includes additional staffed projects and legacy assignments once, excluding other tenants and identities', async () => {
    const db = database({ memberships: [member('staffed'), member('legacy'), member('admin', { user_type: 'admin' }), member('foreign', { organization_id: 'other' })],
      projects: [project('staffed', { created_at: '2026-02-01' }), project('legacy', { assigned_developer_id: 'person' }), project('admin'), project('foreign', { organization_id: 'other' })] });
    expect((await loadDashboardOwnProjects(db, ctx)).map(p => p.id)).toEqual(['staffed', 'legacy']);
  });
  it('never treats an admin profile UUID as a developer assignment', async () => {
    const db = database({ memberships: [member('admin', { user_type: 'admin' }), member('developer')], projects: [project('admin'), project('developer', { assigned_developer_id: 'person' })] });
    expect((await loadDashboardOwnProjects(db, { ...ctx, userType: 'admin' })).map(p => p.id)).toEqual(['admin']);
    expect(db.calls.some(([, key]) => key === 'assigned_developer_id')).toBe(false);
  });
  it('paginates memberships instead of silently dropping large portfolios', async () => {
    const memberships = Array.from({ length: 501 }, (_, n) => member(String(n)));
    const db = database({ memberships, projects: memberships.map(m => project(m.project_id)) });
    expect(await loadDashboardOwnProjects(db, ctx)).toHaveLength(501);
  });
  it.each(['project_members', 'projects'])('rejects %s lookup failure instead of reporting no assignments', async failTable => {
    await expect(loadDashboardOwnProjects(database({ failTable }), ctx)).rejects.toThrow('Could not load');
  });
  it('rejects incomplete identity before querying', async () => {
    const db = { from: vi.fn() };
    await expect(loadDashboardOwnProjects(db, { ...ctx, organizationId: null })).rejects.toThrow('identity');
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe('Staff section effective permissions', () => {
  afterEach(clearPermissionSet);
  it('denies direct section access and sidebar entries using the same effective set', async () => {
    await loadPermissionSet(async () => ({ ok: true, json: async () => ({ success: true, permissions: [] }) }));
    for (const section of ['my-work', 'timesheet', 'projects', 'my-attendance', 'my-leave', 'my-reviews', 'my-activity', 'my-tests', 'team']) {
      expect(canAccessAdminSection(section, 'manager')).toBe(false);
      expect(staffNav('manager').some(item => item.id === section)).toBe(false);
    }
    expect(canAccessAdminSection('account', 'manager')).toBe(true);
  });
  it('honors an explicit hierarchy grant instead of recomputing role defaults', async () => {
    await loadPermissionSet(async () => ({ ok: true, json: async () => ({ success: true, permissions: ['hierarchy.view'] }) }));
    expect(canAccessAdminSection('team', 'developer')).toBe(true);
  });
});
