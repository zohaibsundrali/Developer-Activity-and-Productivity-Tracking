import { describe, expect, it } from 'vitest';
import { peopleRows, projectRows } from '@/utils/adminOverview';

function fixture() {
  const admin = { userId: 'shared', userType: 'admin', name: 'Admin', role: 'manager', status: 'active' };
  const developer = { userId: 'shared', userType: 'developer', name: 'Developer', role: 'developer', status: 'active' };
  const task = { id: 'task', project_id: 'project', developer_id: 'shared', status: 'pending' };
  return {
    people: [admin, developer],
    personByIdentity: new Map([['admin:shared', admin], ['developer:shared', developer]]),
    personById: new Map(),
    projects: [{ id: 'project', name: 'Project', manager_id: 'shared', manager_type: 'admin' }],
    tasksByProject: new Map([['project', [task]]]),
    tasksByIdentity: new Map([['developer:shared', [task]]]),
    tasksByPerson: new Map([['shared', [task]]]),
  };
}

describe('overview typed people attribution', () => {
  it('shows the assigned Admin manager without borrowing the Developer identity', () => {
    expect(projectRows(fixture())[0].manager).toMatchObject({ userType: 'admin', name: 'Admin' });
  });

  it('keeps both profiles and gives work and management to their actual identities', () => {
    const rows = peopleRows(fixture());
    expect(rows).toHaveLength(2);
    expect(rows.find(p => p.userType === 'admin')).toMatchObject({ openTasks: 0, managingCount: 1 });
    expect(rows.find(p => p.userType === 'developer')).toMatchObject({ openTasks: 1, managingCount: 0 });
  });

  it('does not guess an ambiguous legacy manager', () => {
    const graph = fixture();
    graph.projects[0].manager_type = null;
    expect(projectRows(graph)[0].manager).toBeNull();
    expect(peopleRows(graph).every(p => p.managingCount === 0)).toBe(true);
  });
});
