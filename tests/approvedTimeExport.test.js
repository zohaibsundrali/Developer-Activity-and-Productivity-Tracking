import { beforeEach, expect, it, vi } from 'vitest';
import { validExportRange, validApprovedSnapshot, approvedTimeCsv } from '@/utils/approvedTimeExport';
const h = vi.hoisted(() => ({ auth: null, result: null, rpc: vi.fn() }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => h.auth, orgScopedClient: token => ({ rpc: async (...args) => { h.rpc(token, ...args); return h.result; } }) }));
const { GET } = await import('@/app/api/payroll/export/route');
const org = '99100000-0000-0000-0000-000000000001', id = '99100000-0000-0000-0000-000000000011';
const from = '2026-09-14', to = '2026-09-21';
const row = () => ({ timesheet_id: id, user_id: id, user_type: 'developer', name: '=HYPERLINK("unsafe")', week_start: from, approved_seconds: 1003, approved_at: '2026-09-21T09:00:00+00:00', approved_by: id, approved_by_type: 'admin', source_updated_at: '2026-09-21T09:00:00+00:00' });
const data = () => ({ organization_id: org, from_week: from, to_week: to, captured_at: '2026-09-22T09:00:00+00:00', count: 1, rows: [row()] });
const get = (query = `from=${from}&to=${to}`) => GET(new Request('https://app.test/api/payroll/export?' + query));
beforeEach(() => { h.auth = { token: 'caller', orgId: org, appUserId: id, userType: 'admin', role: 'finance', overridesLoaded: true, overrides: {} }; h.result = { data: data(), error: null }; h.rpc.mockClear(); });
it('accepts up to 13 complete Monday-based weeks', () => {
  expect(validExportRange(from, to)).toBe(true); expect(validExportRange(from, '2026-12-07')).toBe(true);
  expect(validExportRange(from, '2026-12-14')).toBe(false); expect(validExportRange('2026-09-15', to)).toBe(false);
  expect(validExportRange('2026-02-30', to)).toBe(false); expect(validExportRange(to, from)).toBe(false);
});
it('exports exact approved seconds and protects formula cells', () => {
  expect(validApprovedSnapshot(data(), org, from, to)).toBe(true);
  const csv = approvedTimeCsv(data(), 'abc'); expect(csv).toContain('1003,0.278611'); expect(csv).toContain('"\'=HYPERLINK(""unsafe"")"'); expect(csv).not.toContain('billable');
});
it.each([{ approved_seconds: null }, { approved_seconds: -1 }, { approved_seconds: '10' }, { user_type: 'client' }, { week_start: '2026-09-28' }, { approved_at: null }, { approved_by_type: null }])('rejects unverified source %j', patch => {
  const snapshot = data(); Object.assign(snapshot.rows[0], patch); expect(validApprovedSnapshot(snapshot, org, from, to)).toBe(false);
});
it('rejects count mismatch, foreign organization and duplicate person/week', () => {
  const snapshot = data(); snapshot.count = 2; expect(validApprovedSnapshot(snapshot, org, from, to)).toBe(false);
  snapshot.rows.push({ ...row(), timesheet_id: '99100000-0000-0000-0000-000000000012' }); expect(validApprovedSnapshot(snapshot, org, from, to)).toBe(false);
  expect(validApprovedSnapshot(data(), 'foreign', from, to)).toBe(false);
});
it('allows finance via caller credentials and returns private downloadable CSV', async () => {
  const response = await get(); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('content-disposition')).toContain('.csv'); expect(response.headers.get('x-export-count')).toBe('1');
  expect(h.rpc).toHaveBeenCalledWith('caller', 'approved_time_export', { p_from: from, p_to: to });
});
it('keeps fingerprints stable on retries but changes them for a corrected source', async () => {
  const first = (await get()).headers.get('x-export-fingerprint'); h.result.data.captured_at = '2026-09-22T10:00:00Z';
  expect((await get()).headers.get('x-export-fingerprint')).toBe(first);
  h.result.data.rows[0].source_updated_at = '2026-09-22T09:30:00Z'; expect((await get()).headers.get('x-export-fingerprint')).not.toBe(first);
});
it.each([null, { role: 'developer', userType: 'developer' }, { role: 'client', userType: 'client' }, { role: 'owner', userType: 'admin', overrides: { 'timesheet.view_all': false } }])('denies unauthorized export %j', async patch => {
  h.auth = patch ? { ...h.auth, ...patch } : null; expect((await get()).status).toBe(patch ? 403 : 401); expect(h.rpc).not.toHaveBeenCalled();
});
it('refuses invalid dates and unavailable permission state before calling the database', async () => {
  expect((await get('from=2026-09-15&to=2026-09-21')).status).toBe(400); h.auth.overridesLoaded = false;
  expect((await get()).status).toBe(503); expect(h.rpc).not.toHaveBeenCalled();
});
it.each([['42501', 403], ['54000', 413], ['55000', 409], ['XX000', 503]])('maps %s without disclosing database details', async (code, status) => {
  h.result = { error: { code, message: 'private SQL context' } }; const response = await get(); expect(response.status).toBe(status); expect(await response.text()).not.toContain('private SQL');
});
it('refuses empty or malformed snapshots instead of producing misleading CSV', async () => {
  h.result.data.rows = []; h.result.data.count = 0; expect((await get()).status).toBe(404);
  h.result.data.count = 1; expect((await get()).status).toBe(503);
});
