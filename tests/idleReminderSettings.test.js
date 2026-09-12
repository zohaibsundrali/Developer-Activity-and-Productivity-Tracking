import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [], refs: [], cursor: 0, refCursor: 0, effects: [], rpc: vi.fn(), org: 'org-a' }));
vi.mock('react', async () => ({ ...(await vi.importActual('react')),
  useState: initial => { const i = h.cursor++; if (!(i in h.values)) h.values[i] = initial; return [h.values[i], value => { h.values[i] = typeof value === 'function' ? value(h.values[i]) : value; }]; },
  useRef: initial => { const i = h.refCursor++; return h.refs[i] ||= { current: initial }; },
  useEffect: callback => { h.effects.push(callback); },
}));
vi.mock('@/utils/supabaseClient', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/utils/orgContext', () => ({ getOrgId: () => h.org }));
vi.mock('@/components/ui', () => ({ Card: 'section', CardHeader: 'header', CardTitle: 'h2', CardContent: 'div', Button: 'button', Field: 'label', Input: 'input' }));
globalThis.React = await vi.importActual('react');
const { default: Settings, validIdleThreshold } = await import('@/components/shared/IdleReminderSettings');
const policy = { organization_id: 'org-a', enabled: true, threshold_seconds: 60, can_manage: true };
function render(props = {}) { h.cursor = 0; h.refCursor = 0; return Settings({ orgId: 'org-a', readOnly: false, ...props }); }
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [].concat(node.props?.children || []).flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
  return null;
}
const control = (tree, label) => find(tree, node => node.props?.['aria-label'] === label);
const saveButton = tree => find(tree, node => node.type === 'button' && node.props.children === 'Save idle reminder policy');
async function mount(props) { render(props); h.effects.shift()(); await new Promise(resolve => setTimeout(resolve, 0)); return render(props); }
beforeEach(() => { h.values = []; h.refs = []; h.effects = []; h.org = 'org-a'; h.rpc.mockReset().mockResolvedValue({ data: { ...policy } }); });
it.each(['', '59', '3601', '60.5', 'Infinity', '1e2', '-60'])('rejects interval %s', value => expect(validIdleThreshold(value)).toBe(false));
it.each(['60', '3600', '120'])('accepts interval %s', value => expect(validIdleThreshold(value)).toBe(true));
it('loads authoritative policy and only enables save after an edit', async () => {
  let tree = await mount(); expect(h.rpc).toHaveBeenCalledWith('get_idle_reminder_policy');
  expect(saveButton(tree).props.disabled).toBe(true);
  control(tree, 'Idle threshold in seconds').props.onChange({ target: { value: '120' } });
  tree = render(); expect(saveButton(tree).props.disabled).toBe(false);
  h.rpc.mockResolvedValueOnce({ data: { ...policy, threshold_seconds: 120 } });
  await saveButton(tree).props.onClick();
  expect(h.rpc).toHaveBeenLastCalledWith('set_idle_reminder_policy', { p_enabled: true, p_threshold_seconds: 120 });
  expect(saveButton(render()).props.disabled).toBe(true);
});
it.each([{ readOnly: true }, { serverDenied: true }])('does not expose edit controls to readonly user %j', async options => {
  if (options.serverDenied) h.rpc.mockResolvedValue({ data: { ...policy, can_manage: false } });
  const tree = await mount(options); expect(control(tree, 'Enable idle reminders')).toBeNull(); expect(saveButton(tree)).toBeNull();
});
it('shows load error without allowing a default policy save', async () => {
  h.rpc.mockResolvedValue({ error: { message: 'denied' } }); const tree = await mount();
  expect(find(tree, node => node.props?.role === 'alert')).not.toBeNull(); expect(saveButton(tree)).toBeNull();
});
it('rejects another organization response', async () => {
  h.rpc.mockResolvedValue({ data: { ...policy, organization_id: 'other' } }); const tree = await mount();
  expect(saveButton(tree)).toBeNull(); expect(find(tree, node => node.props?.role === 'alert')).not.toBeNull();
});
it('does not send stale organization edits after account context changes', async () => {
  let tree = await mount(); control(tree, 'Enable idle reminders').props.onChange({ target: { checked: false } });
  h.org = 'other'; await saveButton(render()).props.onClick(); expect(h.rpc).toHaveBeenCalledTimes(1);
  expect(find(render(), node => node.props?.role === 'alert').props.children).toContain('Organization changed');
});
it('keeps unsaved changes and reports a save denial', async () => {
  let tree = await mount(); control(tree, 'Enable idle reminders').props.onChange({ target: { checked: false } });
  h.rpc.mockResolvedValueOnce({ error: { message: 'permission revoked' } }); await saveButton(render()).props.onClick();
  tree = render(); expect(control(tree, 'Enable idle reminders').props.checked).toBe(false);
  expect(saveButton(tree).props.disabled).toBe(false); expect(find(tree, node => node.props?.role === 'alert')).not.toBeNull();
});
it('ignores a late load response after component unmount', async () => {
  let resolve; h.rpc.mockReturnValue(new Promise(done => { resolve = done; })); render(); const cleanup = h.effects.shift()(); cleanup();
  resolve({ data: policy }); await new Promise(done => setTimeout(done, 0)); expect(saveButton(render())).toBeNull();
});
