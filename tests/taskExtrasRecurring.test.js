import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ values: [], cursor: 0, save: vi.fn(), onChanged: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return { ...actual,
    useState: initial => {
      const index = h.cursor++;
      if (!(index in h.values)) h.values[index] = typeof initial === 'function' ? initial() : initial;
      return [h.values[index], value => { h.values[index] = typeof value === 'function' ? value(h.values[index]) : value; }];
    }, useEffect: () => {}, useCallback: callback => callback,
  };
});
vi.mock('@/utils/pmData', () => ({ setRecurring: h.save, TASK_TYPES: [],
  setTaskType: vi.fn(), setTaskLabels: vi.fn(), setTaskCustomFields: vi.fn(), loadLabels: vi.fn(),
  createLabel: vi.fn(), loadCustomFields: vi.fn(), createCustomField: vi.fn(), loadActivity: vi.fn(),
}));
vi.mock('@/utils/alerts', () => ({ showError: vi.fn() }));
vi.mock('@/components/ui', () => ({ Badge: 'span', Button: 'button' }));
globalThis.React = await vi.importActual('react');
const { default: TaskExtras } = await import('@/components/admin/TaskExtras');
const props = { task: { id: 'task-a', is_recurring: true, recurrence: { freq: 'weekly', interval: 1 } }, projectId: 'project', onChanged: h.onChanged };
const render = () => { h.cursor = 0; return TaskExtras(props); };
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [].concat(node.props?.children || []).flat(Infinity)) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}
beforeEach(() => { h.values = []; h.cursor = 0; h.save.mockReset().mockResolvedValue({ error: null }); h.onChanged.mockReset(); });
it.each(['', '0', '1.5', '-1', '3651', 'Infinity'])('prevents saving invalid interval %s and shows inline error', async value => {
  const input = find(render(), node => node.props?.['aria-label'] === 'Recurrence interval');
  await input.props.onBlur({ target: { value } });
  expect(h.save).not.toHaveBeenCalled();
  expect(find(render(), node => node.props?.role === 'alert').props.children).toBe('Enter a whole number from 1 to 3650.');
});
it('refuses an unexpected frequency before any save', async () => {
  const select = find(render(), node => node.type === 'select' && node.props.value === 'weekly');
  select.props.onChange({ target: { value: 'hourly' } });
  expect(h.save).not.toHaveBeenCalled();
  expect(find(render(), node => node.props?.role === 'alert').props.children).toContain('daily, weekly, or monthly');
});
it('saves a valid integer and leaves no inline validation error', async () => {
  const input = find(render(), node => node.props?.['aria-label'] === 'Recurrence interval');
  expect(input.props).toMatchObject({ min: 1, max: 3650, step: 1 });
  await input.props.onBlur({ target: { value: '3650' } });
  expect(h.save).toHaveBeenCalledWith('task-a', { is_recurring: true, recurrence: { freq: 'weekly', interval: 3650 } }, expect.any(Object));
  expect(h.onChanged).toHaveBeenCalledOnce();
  expect(find(render(), node => node.props?.role === 'alert')).toBeNull();
});
it('allows disabling an invalid legacy schedule', async () => {
  const input = find(render(), node => node.props?.['aria-label'] === 'Recurrence interval');
  await input.props.onBlur({ target: { value: '0' } });
  const checkbox = find(render(), node => node.type === 'input' && node.props.type === 'checkbox');
  await checkbox.props.onChange({ target: { checked: false } });
  expect(h.save).toHaveBeenCalledWith('task-a', { is_recurring: false, recurrence: {} }, expect.any(Object));
});
