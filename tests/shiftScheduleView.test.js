import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [], refs: [], effects: [], cursor: 0, refCursor: 0, identity: 'first', manage: true, own: true, status: 'authenticated', onChange: null, controller: null }));
vi.mock('react', async () => ({ ...(await vi.importActual('react')),
  useState: initial => { const i = h.cursor++; if (!(i in h.values)) h.values[i] = typeof initial === 'function' ? initial() : initial; return [h.values[i], value => { h.values[i] = typeof value === 'function' ? value(h.values[i]) : value; }]; },
  useRef: initial => { const i = h.refCursor++; return h.refs[i] ||= { current: initial }; },
  useEffect: callback => { h.effects.push(callback); },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ authStatus: h.status }) }));
vi.mock('@/utils/orgContext', () => ({ getOrgContext: () => ({ organizationId: '99100000-0000-0000-0000-000000000001', identity: h.identity }) }));
vi.mock('@/utils/reportViewState', () => ({ reportIdentity: value => value.identity }));
vi.mock('@/utils/permissions', () => ({ allowed: key => key === 'attendance.view_own' ? h.own : h.manage }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } }));
vi.mock('@/utils/authFetch', () => ({ authFetch: vi.fn() }));
vi.mock('@/components/ui', () => ({ Button: 'button', PageHeader: 'header', ErrorState: 'aside' }));
vi.mock('@/utils/workShiftPager', () => ({ createWorkShiftPager: (_, onChange) => { h.onChange = onChange; return h.controller = { load: vi.fn(), dispose: vi.fn() }; } }));
globalThis.React = await vi.importActual('react');
const { default: Schedule } = await import('@/components/shared/ShiftSchedule');
function nodes(node, predicate) { if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...[].concat(node.props?.children || []).flat(Infinity).flatMap(child => nodes(child, predicate))]; }
const button = (tree, label) => nodes(tree, n => n.type === 'button' && n.props.children === label)[0];
function render() { h.cursor = 0; h.refCursor = 0; return Schedule(); }
function loaded(status = 'published') {
  h.onChange({ loading: false, error: '', nextCursor: 'next', canManage: true, canViewAll: true, shifts: [{ id: 'b1000000-0000-0000-0000-000000000001', assignee_name: 'Staff', title: 'Night shift', status, start_at: '2026-10-12T21:00:00Z', end_at: '2026-10-13T05:00:00Z', timezone: 'UTC', note: '' }] });
}
beforeEach(() => Object.assign(h, { values: [], refs: [], effects: [], identity: 'first', manage: true, own: true, status: 'authenticated' }));
it('shows an overnight schedule and offers management actions to managers', () => {
  render(); h.effects[1](); loaded(); const tree = render();
  expect(nodes(tree, n => n.type === 'article')).toHaveLength(1);
  expect(button(tree, 'Edit shift')).toBeTruthy(); expect(button(tree, 'Cancel shift')).toBeTruthy();
  button(tree, 'Load more shifts').props.onClick(); expect(h.controller.load).toHaveBeenLastCalledWith(true);
});
it('hides old schedule data immediately on account change before effects', () => {
  render(); h.effects[1](); loaded(); h.identity = 'second'; const tree = render();
  expect(nodes(tree, n => n.type === 'article')).toHaveLength(0); expect(button(tree, 'New shift')).toBeUndefined();
});
it('respects revoked management permission even if the list receipt granted it', () => {
  render(); h.effects[1](); loaded(); h.manage = false; const tree = render();
  expect(nodes(tree, n => n.type === 'article')).toHaveLength(1); expect(button(tree, 'Edit shift')).toBeUndefined(); expect(button(tree, 'New shift')).toBeUndefined();
});
it('keeps cancelled shifts visible without edit or cancel actions', () => {
  render(); h.effects[1](); loaded('cancelled'); const tree = render();
  expect(nodes(tree, n => n.type === 'article')).toHaveLength(1); expect(button(tree, 'Edit shift')).toBeUndefined(); expect(button(tree, 'Cancel shift')).toBeUndefined();
});
it('refuses the whole view after own-view permission is revoked', () => {
  render(); h.effects[1](); loaded(); h.own = false; const tree = render();
  expect(tree.type).toBe('aside'); expect(nodes(tree, n => n.type === 'article')).toHaveLength(0);
});
