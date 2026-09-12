import { describe, it, expect, vi } from 'vitest';
import { loadProductivityOptions, loadProductivityPermission, productivityQuery, loadProductivityView } from '../src/utils/productivityViewData';
const response = (data, ok = true) => ({ ok, json: async () => data });
function clientFor(pages) {
  const calls = [];
  return { calls, from(table) {
    const query = { select(columns, options) { calls.push({ table, columns, options }); return query; }, eq(key, value) { calls.push({ table, key, value }); return query; }, order() { return query; }, range(from, to) { calls.push({ table, from, to }); return Promise.resolve(pages[table].shift()); } };
    return query;
  } };
}
describe('productivity options completeness and privacy', () => {
  it('pages at the actual hosted cap and selects only id/name with mandatory organization scope', async () => {
    const db = clientFor({ developers: [{ data: [{ id: 'a', name: 'A', email: 'private' }], count: 2 }, { data: [{ id: 'b', name: 'B' }], count: 2 }], projects: [{ data: [], count: 0 }] });
    const result = await loadProductivityOptions(db, 'org');
    expect(result.developers).toEqual([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    expect(db.calls).toContainEqual({ table: 'developers', from: 1, to: 500 });
    expect(db.calls.filter(call => call.columns).every(call => call.columns === 'id, name')).toBe(true);
    expect(db.calls).toContainEqual({ table: 'projects', key: 'organization_id', value: 'org' });
  });
  it('never issues unscoped reads', async () => {
    const db = { from: vi.fn() };
    await expect(loadProductivityOptions(db, null)).rejects.toThrow('organization');
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each([{ data: null, count: 0, error: {} }, { data: [], count: 2 }, { data: [], count: null }])('fails visibly instead of returning partial/empty options %j', async page => {
    const db = clientFor({ developers: [page], projects: [{ data: [], count: 0 }] });
    await expect(loadProductivityOptions(db, 'org')).rejects.toThrow();
  });
  it('discards stale identity option responses', async () => {
    const db = clientFor({ developers: [{ data: [], count: 0 }], projects: [{ data: [], count: 0 }] });
    let reads = 0;
    expect(await loadProductivityOptions(db, 'org', () => ++reads < 3)).toBeNull();
  });
});
describe('productivity permission and selection requests', () => {
  it('requires effective report permission and rejects unavailable overrides', async () => {
    await expect(loadProductivityPermission(async () => response({ success: true, permissions: ['report.view'] }))).resolves.toBe(true);
    for (const data of [{ success: true, permissions: [] }, { success: true, permissions: ['report.view'], overridesUnavailable: true }]) await expect(loadProductivityPermission(async () => response(data))).rejects.toThrow();
  });
  it('issues no request for empty selection and refuses unavailable selected records', () => {
    const options = { developers: [{ id: 'a' }], projects: [{ id: 'p' }] };
    expect(productivityQuery('developer', '', '', options)).toBeNull();
    expect(productivityQuery('project', 'a', '', options)).toBeNull();
    expect(() => productivityQuery('developer', 'other', '', options)).toThrow('no longer');
    expect(productivityQuery('project', 'a', 'p', options)).toBe('/api/productivity?type=project&developerId=a&projectId=p');
  });
  it('honors HTTP failure even if body incorrectly claims success', async () => {
    await expect(loadProductivityView(async () => response({ success: true, developerId: 'a' }, false), '/api/productivity?type=developer&developerId=a')).rejects.toThrow();
  });
  it('discards older selection responses and rejects mismatched receipts', async () => {
    let active = true;
    const fetcher = async () => { active = false; return response({ success: true, developerId: 'old' }); };
    expect(await loadProductivityView(fetcher, '/api/productivity?type=developer&developerId=old', () => active)).toBeNull();
    await expect(loadProductivityView(async () => response({ success: true, developerId: 'other' }), '/api/productivity?type=developer&developerId=a')).rejects.toThrow('confirm');
  });
});

describe('project modal selection lifecycle', () => {
  it('omits absent developer filters instead of sending literal null', async () => {
    const { projectProductivityUrl } = await import('../src/utils/productivityViewData');
    expect(projectProductivityUrl('project', null)).toBe('/api/productivity?type=project&projectId=project');
    expect(projectProductivityUrl('project', 'developer')).toBe('/api/productivity?type=project&projectId=project&developerId=developer');
  });
  it('discards a late first modal response after switching projects or closing', async () => {
    const { createProductivityRequestGate } = await import('../src/utils/productivityViewData');
    const gate = createProductivityRequestGate();
    const first = gate.begin(() => true);
    const second = gate.begin(() => true);
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    gate.invalidate();
    expect(second()).toBe(false);
  });
  it('discards a modal response when the identity changes in flight', async () => {
    const { createProductivityRequestGate } = await import('../src/utils/productivityViewData');
    const gate = createProductivityRequestGate();
    let identity = 'first';
    const current = gate.begin(() => identity === 'first');
    identity = 'second';
    expect(current()).toBe(false);
  });
  it('rejects a successful receipt for another organization', async () => {
    const fetcher = async () => response({ success: true, projectId: 'project', orgId: 'other' });
    await expect(loadProductivityView(fetcher, '/api/productivity?type=project&projectId=project', () => true, 'org')).rejects.toThrow('organization');
  });
});
