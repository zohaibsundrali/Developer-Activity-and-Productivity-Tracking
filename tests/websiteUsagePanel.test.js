import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [], refs: [], memos: [], effects: [], cursor: 0, refCursor: 0, memoCursor: 0, controller: null, onChange: null, current: true, downloaded: vi.fn() }));
vi.mock('react', async () => ({ ...(await vi.importActual('react')),
  useState: initial => { const i = h.cursor++; if (!(i in h.values)) h.values[i] = initial; return [h.values[i], value => { h.values[i] = typeof value === 'function' ? value(h.values[i]) : value; }]; },
  useRef: initial => { const i = h.refCursor++; return h.refs[i] ||= { current: initial }; },
  useMemo: (compute, deps) => { const i = h.memoCursor++; if (!h.memos[i] || deps.some((x, n) => x !== h.memos[i].deps[n])) h.memos[i] = { value: compute(), deps }; return h.memos[i].value; },
  useEffect: callback => { h.effects.push(callback); },
}));
vi.mock('@/components/ui', () => ({ Button: 'button' }));
vi.mock('@/hooks/useVisibleInterval', () => ({ setVisibleInterval: () => () => {} }));
vi.mock('@/utils/reportExport', () => ({ downloadReportBlob: h.downloaded }));
vi.mock('@/utils/monitoringBrowserController', () => ({ createBrowserUsageController: ({ onChange }) => { h.onChange = onChange; return h.controller = { refresh: vi.fn(), dispose: vi.fn(), current: () => h.current }; } }));
globalThis.React = await vi.importActual('react');
const { default: Panel } = await import('@/components/shared/WebsiteUsagePanel');
function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...[].concat(node.props?.children || []).flat(Infinity).flatMap(child => nodes(child, predicate))];
}
const button = (tree, text) => nodes(tree, node => node.type === 'button' && node.props.children === text)[0];
const client = { channel: () => { const c = { on: () => c, subscribe: vi.fn() }; return c; }, removeChannel: vi.fn() };
const makeGuard = () => ({ current: () => true, accepts: () => true });
const props = { client, organizationId: 'org', email: 'employee@example.test', start: '2026-09-12T00:00:00Z', end: '2026-09-13T00:00:00Z', makeGuard };
function render(changes = {}) { h.cursor = 0; h.refCursor = 0; h.memoCursor = 0; return Panel({ ...props, ...changes }); }
function loaded(count) {
  const sites = Array.from({ length: count }, (_, i) => ({ site: `site-${i}`, seconds: i, records: 1 }));
  h.onChange({ loading: false, error: '', summary: { sites, records: count, totalSeconds: 325 }, rows: sites.map(s => ({ site: s.site, duration_seconds: s.seconds, first_seen: props.start, last_seen: props.start, session_id: 'test' })) });
}
beforeEach(() => {
  Object.assign(h, { values: [], refs: [], memos: [], effects: [], current: true }); h.downloaded.mockClear();
  globalThis.window = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
});
it('paginates site totals while exporting the complete result', async () => {
  render(); h.effects.shift()(); loaded(26);
  let tree = render();
  expect(nodes(tree, n => n.type === 'tbody')[0].props.children).toHaveLength(25);
  button(tree, 'Next websites').props.onClick(); tree = render();
  expect(nodes(tree, n => n.type === 'tbody')[0].props.children).toHaveLength(1);
  button(tree, 'Export website CSV').props.onClick();
  expect(h.downloaded).toHaveBeenCalledOnce();
  expect((await h.downloaded.mock.calls[0][0].text()).split('\r\n')).toHaveLength(27);
});
it('hides previous identity data immediately, before the next effect runs', () => {
  render(); h.effects.shift()(); loaded(1);
  const tree = render({ email: 'new-account@example.test' });
  expect(nodes(tree, n => n.type === 'tbody')).toHaveLength(0);
  expect(button(tree, 'Export website CSV').props.disabled).toBe(true);
});
it('refuses export when permission or identity changed without a render', () => {
  render(); h.effects.shift()(); loaded(1); const tree = render();
  h.current = false; button(tree, 'Export website CSV').props.onClick();
  expect(h.downloaded).not.toHaveBeenCalled();
});
it('shows failure and retry without retaining previous totals', () => {
  render(); h.effects.shift()(); loaded(1);
  h.onChange({ loading: false, error: 'Retry required', rows: [], summary: { sites: [], records: 0, totalSeconds: 0 } });
  const tree = render();
  expect(nodes(tree, n => n.props.role === 'alert')[0].props.children).toBe('Retry required');
  expect(button(tree, 'Export website CSV').props.disabled).toBe(true);
  button(tree, 'Refresh websites').props.onClick(); expect(h.controller.refresh).toHaveBeenCalledTimes(2);
});
