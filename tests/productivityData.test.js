import { describe, expect, it, vi } from 'vitest';
vi.mock('@/utils/supabaseClient', () => ({ supabase: {} }));
import { projectProductivity, developerProductivity, overallProductivity, calculateProjectProductivity, calculateDeveloperProductivity, calculateOverallProductivity } from '@/utils/productivityData';
const task = (id, patch = {}) => ({ id: String(id), organization_id: 'org', project_id: 'p1', developer_id: 'd1', status: 'completed', is_on_time: true, ...patch });
function database(tables, { cap = 1000, errorTable = null, countChange = false, repeat = false, missingCount = false } = {}) {
  const calls = [];
  return { calls, client: { from(table) {
    const call = { table, filters: {}, orders: [], countRequested: null }; calls.push(call);
    const q = {
      select: (columns, opts) => { call.columns = columns; call.countRequested = opts?.count; return q; },
      eq: (key, value) => { call.filters[key] = value; return q; },
      order: (key, opts) => { call.orders.push([key, opts]); return q; },
      range: async (from, to) => {
        call.range = [from,to];
        if (errorTable === table) return { data: null, error: new Error('database offline'), count: null };
        const rows = getRows();
        if (from > 0 && from >= rows.length) throw new Error('416 range outside result');
        return { data: rows.slice(repeat && from > 0 ? 0 : from, (repeat && from > 0 ? 0 : from) + Math.min(to-from+1,cap)), error: null,
          count: missingCount ? null : rows.length + (countChange && from > 0 ? 1 : 0) };
      },
      maybeSingle: async () => errorTable === table ? { data: null, error: new Error('database offline') } : ({ data: getRows()[0] || null, error: null }),
    };
    function getRows() { return (tables[table] || []).filter(row => Object.entries(call.filters).every(([key,value]) => row[key] === value)).sort((a,b) => a.id.localeCompare(b.id)); }
    return q;
  } } };
}
const project = { id: 'p1', organization_id: 'org', name: 'Project' };
const developer = { id: 'd1', organization_id: 'org', name: 'Developer' };
describe('canonical productivity calculations', () => {
  it('preserves completed-only on-time ratio and weighted overall formula', () => {
    const result = projectProductivity([task(1),task(2),task(3),task(4,{is_on_time:false})], { projectId: 'p1' });
    expect(result.productivityPercentage).toBe('75.00'); expect(result.overallProductivityPercentage).toBe('50.00');
    expect(result.productivityPoints).toBe(2); expect(result.taskWeight).toBe('25.00');
  });
  it('normalizes all canonical aliases consistently across project, developer and overall metrics', () => {
    const tasks = [task(1,{status:'done'}),task(2,{status:'approved',is_on_time:false}),task(3,{status:'reviewed'}),task(4,{status:'doing'}),task(5,{status:'todo'}),task(6,{status:'rejected'})];
    const p = projectProductivity(tasks); expect(p.summary).toEqual({ completed:2,onTime:1,late:1,pending:1,inProgress:1,awaiting:1,rejected:1 });
    expect(p.tasksBreakdown.map(t=>t.status)).toEqual(['completed','completed','awaiting_approval','in_progress','pending','rejected']);
    const d = developerProductivity(tasks,developer,{developerId:'d1'}); expect(d).toMatchObject({ totalCompleted:2,totalOnTime:1,totalLate:1,totalPending:3 });
    const o = overallProductivity(tasks,[developer],1); expect(o).toMatchObject({ totalCompleted:2,totalOnTime:1 }); expect(o.developersBreakdown[0].lateTasks).toBe(1);
  });
  it('keeps unassessed punctuality neutral in contributions without inventing an on-time rating', () => {
    const p = projectProductivity([task(1,{is_on_time:null})]);
    expect(p.summary).toMatchObject({ completed:1,onTime:0,late:0 }); expect(p.tasksBreakdown[0]).toMatchObject({ contribution:0,contributionLabel:'Not assessed' });
    expect(p.productivityPercentage).toBe('0.00'); expect(p.productivityPoints).toBe(0);
  });
  it('returns complete zero fields for an empty project', () => {
    const p=projectProductivity([],{projectId:'p1'}); expect(p).toMatchObject({ totalTasks:0, productivityPercentage:0, overallProductivityPercentage:0, completionProgress:0 });
    expect(p.summary.inProgress).toBe(0); expect(p.tasksBreakdown).toEqual([]);
  });
});
describe('complete caller-scoped productivity sources', () => {
  it('a project without an explicit developer includes all visible assignees and excludes other organizations', async () => {
    const db=database({ projects:[project], developer_tasks:[task(1),task(2,{developer_id:'d2'}),task(3,{organization_id:'other'})] });
    const p=await calculateProjectProductivity(db.client,'org','p1'); expect(p.totalTasks).toBe(2);
    expect(db.calls.filter(c=>c.table==='developer_tasks').every(c=>!Object.hasOwn(c.filters,'developer_id'))).toBe(true);
    expect(db.calls.every(c=>c.filters.organization_id==='org')).toBe(true);
  });
  it('uses an explicit developer filter for own project tasks', async () => {
    const db=database({ projects:[project], developers:[developer], developer_tasks:[task(1),task(2,{developer_id:'d2'})] });
    expect((await calculateProjectProductivity(db.client,'org','p1','d1')).totalTasks).toBe(1);
  });
  it.each([{ developers:[] }, { developers:[{ ...developer, organization_id: 'foreign' }] }])('refuses an explicit absent or foreign developer instead of returning zero tasks', async ({ developers }) => {
    const db=database({ projects:[project], developers, developer_tasks:[] });
    await expect(calculateProjectProductivity(db.client,'org','p1','d1')).rejects.toMatchObject({code:'P0002'});
    expect(db.calls.some(call=>call.table==='developer_tasks')).toBe(false);
    expect(db.calls.find(call=>call.table==='developers').filters).toEqual({ organization_id:'org',id:'d1' });
  });
  it('loads all rows beyond a low hosted response cap without extra out-of-range queries', async () => {
    const db=database({ projects:[project], developer_tasks:Array.from({length:5},(_,i)=>task(i)) },{cap:2});
    const p=await calculateProjectProductivity(db.client,'org','p1'); expect(p.totalTasks).toBe(5);
    expect(db.calls.filter(c=>c.table==='developer_tasks').map(c=>c.range)).toEqual([[0,999],[2,1001],[4,1003]]);
    expect(db.calls.filter(c=>c.range).every(c=>c.countRequested==='exact'&&c.orders[0][0]==='id')).toBe(true);
  });
  it('does not introduce a task cap or a huge developer IN filter in overall metrics', async () => {
    const db=database({ projects:[project],developers:[developer],developer_tasks:Array.from({length:1101},(_,i)=>task(i)) });
    const result=await calculateOverallProductivity(db.client,'org'); expect(result.totalTasks).toBe(1101); expect(result.totalCompleted).toBe(1101);
    expect(db.calls.every(c=>c.filters.organization_id==='org')).toBe(true);
  });
  it('returns typed admin self metrics without accessing a colliding developer or its tasks', async () => {
    const db=database({ admin_users:[{id:'d1',organization_id:'org',full_name:'Admin'}],developers:[developer],developer_tasks:[task(1)] });
    const result=await calculateDeveloperProductivity(db.client,'org','d1','admin'); expect(result).toMatchObject({developerName:'Admin',userType:'admin',totalTasks:0,totalCompleted:0});
    expect(db.calls.map(c=>c.table)).toEqual(['admin_users']);
  });
  it('resolves project visibility but never reads colliding tasks for admin own project scope', async () => {
    const db=database({projects:[project],developer_tasks:[task(1)]});
    expect((await calculateProjectProductivity(db.client,'org','p1','d1','admin')).totalTasks).toBe(0);
    expect(db.calls.map(c=>c.table)).toEqual(['projects']);
  });
  it('resolves developer project names through organization-scoped projects', async () => {
    const db=database({developers:[developer],projects:[project],developer_tasks:[task(1)]});
    const result=await calculateDeveloperProductivity(db.client,'org','d1'); expect(result.projectsBreakdown[0].projectName).toBe('Project');
    expect(result.developerName).toBe('Developer');
  });
  it.each(['developers','developer_tasks','projects'])('fails instead of returning zero when %s is unavailable',async errorTable=>{
    const db=database({developers:[developer],projects:[project],developer_tasks:[task(1)]},{errorTable});
    await expect(calculateOverallProductivity(db.client,'org')).rejects.toThrow('offline');
  });
  it.each([{countChange:true},{repeat:true},{missingCount:true}])('rejects incomplete/changing source pages %j',async flags=>{
    const db=database({projects:[project],developer_tasks:[task(1),task(2),task(3)]},{cap:2,...flags});
    await expect(calculateProjectProductivity(db.client,'org','p1')).rejects.toThrow('changed');
  });
  it('distinguishes a missing requested subject from an empty task set',async()=>{
    const db=database({}); await expect(calculateDeveloperProductivity(db.client,'org','d1')).rejects.toMatchObject({code:'P0002'});
  });
});
