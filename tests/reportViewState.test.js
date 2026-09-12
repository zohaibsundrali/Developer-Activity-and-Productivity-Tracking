import { describe, it, expect, vi } from 'vitest';
import { reportIdentity, validateReportAggregate, currentReportState } from '../src/utils/reportViewState';

const context = { organizationId: 'org', userType: 'developer', userId: 'person', role: 'manager' };
const range = { from: '2026-09-01', to: '2026-09-12' };
const data = {orgId:'org',range,view:'time',rows:[],total:0,nextOffset:null};

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
    expect(validateReportAggregate(data, 'org', range, 'time')).toBe(data);
  });
  it('rejects incomplete pages', () => {
    for (const patch of [{rows:null},{total:-1},{nextOffset:1}]) {
      expect(() => validateReportAggregate({...data,...patch},'org',range,'time')).toThrow();
    }
  });
  it('rejects mismatched organization/range and view', () => {
    expect(() => validateReportAggregate(data,'other',range,'time')).toThrow();
    expect(() => validateReportAggregate(data,'org',{...range,to:'2026-09-11'},'time')).toThrow();
    expect(() => validateReportAggregate(data,'org',range,'team')).toThrow();
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
