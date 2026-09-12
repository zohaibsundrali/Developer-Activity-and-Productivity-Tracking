import { describe, expect, it, vi } from 'vitest';
import { resolveSessionWorkContext, sessionWorkLabel } from '../src/utils/sessionWorkContext';
function clientFor(data, error = null) {
  const queries = [];
  return { queries, from: vi.fn(table => {
    const query = { table };
    queries.push(query);
    const chain = {
      select: fields => { query.fields = fields; return chain; },
      eq: (key, value) => { query[key] = value; return chain; },
      in: async (key, values) => { query.ids = values; return { data: data[table], error }; },
    };
    return chain;
  }) };
}
describe('session work labels', () => {
  it('leaves historical unassigned sessions usable without new table reads', async () => {
    const client = clientFor({});
    const [row] = await resolveSessionWorkContext(client, [{session_id: 'old'}]);
    expect(sessionWorkLabel(row)).toBe('General tracking');
    expect(client.from).not.toHaveBeenCalled();
  });
  it('batches deduplicated work reads and scopes every query by organization', async () => {
    const client = clientFor({ projects: [{id:'p',name:'Project',organization_id:'o'}], developer_tasks:[{id:'t',task_title:'Task',project_id:'p',organization_id:'o'}] });
    const input = {session_id:'s',project_id:'p',task_id:'t',organization_id:'o'};
    const result = await resolveSessionWorkContext(client,[input,{...input,session_id:'s2'}]);
    expect(result.map(sessionWorkLabel)).toEqual(['Project · Task','Project · Task']);
    expect(client.queries).toHaveLength(2);
    expect(client.queries.every(q=>q.organization_id==='o' && q.ids.length===1)).toBe(true);
    expect(input.project_name).toBeUndefined();
  });
  it('does not use names from another organization or a mismatched task project', async () => {
    const client = clientFor({projects:[{id:'p',name:'Secret',organization_id:'other'}],developer_tasks:[{id:'t',task_title:'Secret task',project_id:'other',organization_id:'o'}]});
    const [row] = await resolveSessionWorkContext(client,[{project_id:'p',task_id:'t',organization_id:'o'}]);
    expect(sessionWorkLabel(row)).toBe('Project unavailable · Task unavailable');
  });
  it('does not erase attributed time when names are deleted, inaccessible or reads fail', async () => {
    const client = clientFor({}, {message:'not available'});
    const [row] = await resolveSessionWorkContext(client,[{project_id:'p',task_id:'t',organization_id:'o',total_duration:120}]);
    expect(row.total_duration).toBe(120);
    expect(sessionWorkLabel(row)).toBe('Project unavailable · Task unavailable');
  });
  it('does not trust unverified embedded names from telemetry', async () => {
    const client = clientFor({});
    const [row] = await resolveSessionWorkContext(client,[{project_id:'p',task_id:'t',organization_id:'o',project_name:'Forged',task_title:'Forged'}]);
    expect(sessionWorkLabel(row)).toBe('Project unavailable · Task unavailable');
  });
});
