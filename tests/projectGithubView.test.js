import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [], refs: [], effects: [], cursor: 0, refCursor: 0, identity: 'first', fetch: vi.fn(), authChanged: null }));
vi.mock('react', async () => ({ ...(await vi.importActual('react')),
  useState: initial => { const i = h.cursor++; if (!(i in h.values)) h.values[i] = typeof initial === 'function' ? initial() : initial; return [h.values[i], value => { h.values[i] = typeof value === 'function' ? value(h.values[i]) : value; }]; },
  useRef: initial => { const i = h.refCursor++; return h.refs[i] ||= { current: initial }; }, useEffect: callback => { h.effects.push(callback); },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ authStatus: 'authenticated' }) }));
vi.mock('@/utils/orgContext', () => ({ getOrgContext: () => ({ organizationId: '99100000-0000-0000-0000-000000000001', identity: h.identity }) }));
vi.mock('@/utils/reportViewState', () => ({ reportIdentity: value => value.identity }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: { auth: { onAuthStateChange: callback => { h.authChanged = callback; return { data: { subscription: { unsubscribe() {} } } }; } } } }));
vi.mock('@/utils/authFetch', () => ({ authFetch: h.fetch }));
vi.mock('@/components/ui', () => ({ Button: 'button' }));
globalThis.React = await vi.importActual('react');
const { default: View } = await import('@/components/shared/ProjectGithub');
const projectId = '99100000-0000-0000-0000-000000000011', org = '99100000-0000-0000-0000-000000000001';
const payload = () => ({ success: true, project_id: projectId, organization_id: org, can_manage: true, link: { project_id: projectId, organization_id: org, repository_id: 123, owner: 'octocat', repository: 'Hello-World', version: 1 } });
function nodes(node, predicate) { if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...[].concat(node.props?.children || []).flat(Infinity).flatMap(child => nodes(child, predicate))]; }
function render() { h.cursor = 0; h.refCursor = 0; return View({ projectId }); }
const button = (tree, label) => nodes(tree, n => n.type === 'button' && n.props.children === label)[0];
async function loaded() { render(); h.effects[0](); h.effects[1](); await vi.waitFor(() => expect(h.values[0]).not.toBeNull()); return render(); }
beforeEach(() => { Object.assign(h, { values: [], refs: [], effects: [], identity: 'first' }); h.fetch.mockReset(); h.fetch.mockResolvedValue(Response.json(payload())); });
it('uses a password input and sends its token only in the request body', async () => {
  let tree = await loaded(); nodes(tree, n => n.props['aria-label'] === 'GitHub read token')[0].props.onChange({ target: { value: 'github_pat_example' } }); tree = render();
  h.fetch.mockResolvedValue(Response.json({ ...payload(), items: [], page: 1, nextPage: null, nextAfter: null }));
  await button(tree, 'Refresh GitHub activity').props.onClick(); const call = h.fetch.mock.calls.at(-1);
  expect(call[0]).not.toContain('github_pat_example'); expect(JSON.parse(call[1].body).githubToken).toBe('github_pat_example');
});
it('hides the previous repository immediately on account change', async () => {
  await loaded(); h.identity = 'second'; const tree = render(); expect(nodes(tree, n => n.type === 'a')).toHaveLength(0); expect(button(tree, 'Link repository')).toBeUndefined();
});
it('clears in-memory credentials and context on auth changes', async () => {
  const tree = await loaded(); nodes(tree, n => n.props['aria-label'] === 'GitHub read token')[0].props.onChange({ target: { value: 'github_pat_example' } });
  h.authChanged(); expect(h.values).not.toContain('github_pat_example'); expect(nodes(render(), n => n.type === 'a')).toHaveLength(0);
});
it('shows view-only repository controls when management is unavailable', async () => {
  h.fetch.mockResolvedValue(Response.json({ ...payload(), can_manage: false })); const tree = await loaded(); expect(button(tree, 'Link repository')).toBeUndefined(); expect(button(tree, 'Refresh GitHub activity')).toBeTruthy();
});
