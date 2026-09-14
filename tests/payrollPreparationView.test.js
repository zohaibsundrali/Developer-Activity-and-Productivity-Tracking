import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [], refs: [], effects: [], cursor: 0, refCursor: 0, identity: 'first', permitted: true, fetch: vi.fn(), downloaded: vi.fn() }));
vi.mock('react', async () => ({ ...(await vi.importActual('react')),
  useState: initial => { const i = h.cursor++; if (!(i in h.values)) h.values[i] = typeof initial === 'function' ? initial() : initial; return [h.values[i], value => { h.values[i] = typeof value === 'function' ? value(h.values[i]) : value; }]; },
  useRef: initial => { const i = h.refCursor++; return h.refs[i] ||= { current: initial }; }, useEffect: callback => { h.effects.push(callback); },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ authStatus: 'authenticated' }) }));
vi.mock('@/utils/orgContext', () => ({ getOrgContext: () => ({ identity: h.identity }) }));
vi.mock('@/utils/reportViewState', () => ({ reportIdentity: value => value.identity }));
vi.mock('@/utils/permissions', () => ({ allowed: () => h.permitted }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } }));
vi.mock('@/utils/authFetch', () => ({ authFetch: h.fetch }));
vi.mock('@/utils/reportExport', () => ({ downloadReportBlob: h.downloaded }));
vi.mock('@/components/ui', () => ({ Button: 'button', PageHeader: 'header', ErrorState: 'aside' }));
globalThis.React = await vi.importActual('react');
const { default: View } = await import('@/components/admin/PayrollPreparation');
function nodes(node, predicate) { if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...[].concat(node.props?.children || []).flat(Infinity).flatMap(child => nodes(child, predicate))]; }
function render() { h.cursor = 0; h.refCursor = 0; return View(); }
const response = () => new Response('csv-content', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'X-Export-Fingerprint': 'a'.repeat(64), 'X-Export-Count': '3' } });
const submit = tree => nodes(tree, n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
beforeEach(() => { Object.assign(h, { values: [], refs: [], effects: [], identity: 'first', permitted: true }); h.fetch.mockReset(); h.downloaded.mockClear(); h.fetch.mockResolvedValue(response()); });
it('downloads a verified CSV receipt', async () => {
  const tree = render(); h.effects[0](); await submit(tree);
  expect(h.downloaded).toHaveBeenCalledOnce(); expect(h.downloaded.mock.calls[0][1]).toContain('aaaaaaaaaaaa.csv');
});
it('does not download after a permission or account change during the request', async () => {
  let resolve; h.fetch.mockImplementation(() => new Promise(r => { resolve = r; })); const tree = render(); h.effects[0]();
  const request = submit(tree); h.identity = 'second'; resolve(response()); await request; expect(h.downloaded).not.toHaveBeenCalled();
});
it('requires the export receipt headers even after HTTP success', async () => {
  h.fetch.mockResolvedValue(new Response('not-export')); const tree = render(); h.effects[0](); await submit(tree); expect(h.downloaded).not.toHaveBeenCalled();
  expect(nodes(render(), n => n.props.role === 'alert')[0].props.children).toContain('receipt');
});
it('prevents duplicate requests while an export is pending', async () => {
  let resolve; h.fetch.mockImplementation(() => new Promise(r => { resolve = r; })); const tree = render(); h.effects[0]();
  const first = submit(tree); await submit(tree); expect(h.fetch).toHaveBeenCalledOnce(); resolve(response()); await first;
});
