import { beforeEach, describe, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ tables: {} }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: { from: table => { const q = { select: () => q, eq: () => q, neq: () => q, order: () => q, limit: () => q, then: resolve => Promise.resolve({ data: s.tables[table] || [] }).then(resolve) }; return q; } } }));
import { loadOrgWorkGraph, graphPersonKey, projectManager, projectTeam, personLoad } from '@/utils/orgWorkGraph';
beforeEach(() => { s.tables = {
  projects: [{id:'project',manager_id:'same',manager_type:'admin',assigned_developer_id:'same'}, {id:'legacy',manager_id:'same'}],
  memberships: [{user_id:'same',user_type:'admin',role:'manager',status:'active'}, {user_id:'same',user_type:'developer',role:'employee',status:'active'}],
  admin_users: [{id:'same',full_name:'Admin Name',email:'admin@test'}],
  developers: [{id:'same',name:'Developer Name',email:'developer@test'}],
  developer_tasks: [{id:'task',project_id:'project',developer_id:'same',status:'pending'}],
}; });
describe('work graph typed identity', () => {
  it('preserves both profiles and their correct names', async () => {
    const graph = await loadOrgWorkGraph('org');
    expect(graph.people).toHaveLength(2);
    expect(graph.personByIdentity.get('admin:same').name).toBe('Admin Name');
    expect(graph.personByIdentity.get('developer:same').name).toBe('Developer Name');
    expect(graph.personById.has('same')).toBe(false);
    expect(graph.people.map(graphPersonKey)).toEqual(['admin:same','developer:same']);
    expect(graphPersonKey(null)).toBeNull();
  });
  it('keeps a typed manager separate from a colliding task assignee', async () => {
    const graph = await loadOrgWorkGraph('org');
    const team = projectTeam(graph.projects[0], graph);
    expect(team.manager.key).toBe('admin:same');
    expect(team.team).toMatchObject([{key:'developer:same',name:'Developer Name',taskCount:1}]);
    expect(personLoad(graph.personByIdentity.get('admin:same'),graph)).toMatchObject({openTasks:0,totalTasks:0,managingCount:1});
    expect(personLoad(graph.personByIdentity.get('developer:same'),graph)).toMatchObject({openTasks:1,totalTasks:1,managingCount:0});
  });
  it('does not infer an ambiguous historical manager', async () => {
    const graph = await loadOrgWorkGraph('org');
    expect(projectManager(graph,graph.projects[1])).toBeNull();
  });
  it('preserves a uniquely resolved historical manager', async () => {
    s.tables.memberships.pop();
    const graph = await loadOrgWorkGraph('org');
    expect(projectManager(graph,graph.projects[1]).userType).toBe('admin');
    expect(projectTeam(graph.projects[0],graph).team).toEqual([]);
  });
  it('does not treat a shared email as an untyped assignment', async () => {
    s.tables.developers[0].email='shared@test';s.tables.admin_users[0].email='shared@test';
    s.tables.developer_tasks=[];s.tables.projects[0]={id:'project',assigned_developer_email:'shared@test'};
    const graph=await loadOrgWorkGraph('org');
    expect(graph.personByEmail.has('shared@test')).toBe(false);
    expect(projectTeam(graph.projects[0],graph).team).toEqual([]);
  });
  it('does not substitute an admin profile when its developer profile is missing', async () => {
    s.tables.developers=[];
    const graph=await loadOrgWorkGraph('org');
    expect(graph.personByIdentity.get('developer:same').name).toBe('Member');
  });
});
