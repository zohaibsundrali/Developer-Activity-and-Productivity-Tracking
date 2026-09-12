import { describe, it, expect, vi } from 'vitest';
import { reportIdentity, validateReportBundle, currentReportState } from '../src/utils/reportViewState';

const context = { organizationId: 'org', userType: 'developer', userId: 'person', role: 'manager' };
const range = { from: '2026-09-01', to: '2026-09-12' };
const fields = ['projects', 'tasks', 'employees', 'timeLogs', 'sessions'];
const data = { orgId: 'org', range, ...Object.fromEntries(fields.map(key => [key, []])), truncated: Object.fromEntries(fields.map(key => [key, false])) };

describe('report view authority and refresh state', () => {
  it('distinguishes tenant, typed profile, and role transitions', () => {
    for (const [key, value] of [['organizationId','other'], ['userType','admin'], ['userId','other'], ['role','employee']]) {
      expect(reportIdentity({ ...context, [key]: value })).not.toBe(reportIdentity(context));
    }
    expect(reportIdentity(null)).toBeNull();
    expect(reportIdentity({ ...context, userId: null })).toBeNull();
  });
  it('hides a previously successful report immediately on a new request or logout', () => {
    const result = { scope: 'old', bundle: data, error: '' };
    expect(currentReportState(result, 'new', true)).toEqual({ bundle: null, loading: true, error: '' });
    expect(currentReportState(result, 'old', false).bundle).toBeNull();
    expect(currentReportState(result, 'old', true).bundle).toBe(data);
  });
  it('keeps a failed request distinct from successful empty data and permits retry', () => {
    expect(currentReportState({ scope: 'failed', bundle: null, error: 'Unavailable' }, 'failed', true)).toEqual({ bundle: null, loading: false, error: 'Unavailable' });
    expect(currentReportState({ scope: 'failed', bundle: null, error: 'Unavailable' }, 'retry', true).loading).toBe(true);
    expect(validateReportBundle(data, 'org', range)).toBe(data);
  });
  it('rejects missing arrays, absent flags and incorrectly typed flags', () => {
    for (const key of fields) {
      expect(() => validateReportBundle({ ...data, [key]: null }, 'org', range)).toThrow(/incomplete/);
      for (const invalid of [undefined, null, 'false', 0]) {
        expect(() => validateReportBundle({ ...data, truncated: { ...data.truncated, [key]: invalid } }, 'org', range)).toThrow(/incomplete/);
      }
    }
    for (const truncated of [undefined, null, [], true, {}]) {
      expect(() => validateReportBundle({ ...data, truncated }, 'org', range)).toThrow(/incomplete/);
    }
  });
  it('rejects mismatched organization/range and truncated successful responses', () => {
    expect(() => validateReportBundle(data, 'other', range)).toThrow(/did not match/);
    expect(() => validateReportBundle(data, 'org', { ...range, to: '2026-09-11' })).toThrow(/did not match/);
    expect(() => validateReportBundle(null, 'org', range)).toThrow();
    expect(() => validateReportBundle({ ...data, truncated: { ...data.truncated, tasks: true } }, 'org', range)).toThrow(/shorter date range/);
  });
});

vi.mock('jspdf', () => ({ jsPDF: vi.fn() }));
vi.mock('jspdf-autotable', () => ({ default: vi.fn() }));
it('cancels a PDF if report identity changes during dependency loading', async () => {
  const { exportPdf } = await import('../src/utils/reportExport');
  const { jsPDF } = await import('jspdf');
  await exportPdf({ title: 'Report', columns: [], rows: [], shouldContinue: () => false });
  expect(jsPDF).not.toHaveBeenCalled();
});
